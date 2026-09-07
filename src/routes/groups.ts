import { randomBytes } from 'node:crypto';
import { Router } from 'express';
import type { ResultSetHeader, RowDataPacket } from 'mysql2';
import { z } from 'zod';
import { pool } from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';
import { requireGroup, requireCommissioner } from '../middleware/group.js';
import { HttpError } from '../lib/http-error.js';
import { queueEmail } from '../services/email-outbox.js';
import { config } from '../config.js';

export const groupsRouter = Router();
groupsRouter.use(requireAuth);

groupsRouter.get('/', async (request,response) => {
  const [rows] = await pool.query(
    `SELECT g.id,g.name,m.role, u.display_name AS commissionerName,
      g.require_pick_approval AS requirePickApproval,g.allow_multiple_entries AS allowMultipleEntries,g.joining_enabled AS joiningEnabled,
      CASE WHEN m.role='commissioner' OR ?='admin' THEN g.invite_code ELSE NULL END AS inviteCode,
      (SELECT COUNT(*) FROM group_members WHERE group_id=g.id) AS memberCount
     FROM pool_groups g LEFT JOIN group_members m ON m.group_id=g.id AND m.user_id=?
     LEFT JOIN users u ON u.id=g.created_by
     WHERE m.user_id IS NOT NULL OR ?='admin' ORDER BY g.name,g.id`,
    [request.userRole,request.userId!,request.userRole],
  );
  response.json(rows);
});

groupsRouter.post('/', async (request,response) => {
  const {name} = z.object({name:z.string().transform(value => value.trim().replace(/\s+/g, ' ')).pipe(z.string().min(2).max(100))}).parse(request.body);
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [result] = await connection.execute<ResultSetHeader>(
      'INSERT INTO pool_groups (name,invite_code,created_by) VALUES (?,?,?)',
      [name,randomBytes(16).toString('hex'),request.userId!],
    );
    await connection.execute("INSERT INTO group_members (group_id,user_id,role) VALUES (?,?,'commissioner')",[result.insertId,request.userId!]);
    await connection.commit();
    response.status(201).json({id:result.insertId,name});
  } catch(error) {
    await connection.rollback();
    const dbError = error as { code?: string; message?: string };
    if (dbError.code === 'ER_DUP_ENTRY' && dbError.message?.includes('groups_name_unique')) {
      throw new HttpError(409,'That group name is already taken. Please choose another name.');
    }
    throw error;
  }
  finally { connection.release(); }
});

groupsRouter.post('/join', async (request,response) => {
  const {inviteCode} = z.object({inviteCode:z.string().trim().toLowerCase().regex(/^[a-f0-9]{32}$/)}).parse(request.body);
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.query<RowDataPacket[]>('SELECT id,name,joining_enabled FROM pool_groups WHERE invite_code=? FOR UPDATE',[inviteCode]);
    if (!rows[0]) throw new HttpError(404,'Invite code not found');
    const [members] = await connection.query<RowDataPacket[]>('SELECT user_id FROM group_members WHERE group_id=? AND user_id=?',[rows[0].id,request.userId!]);
    if (!members.length && !rows[0].joining_enabled) throw new HttpError(409,'This group is not accepting new members');
    await connection.execute("INSERT INTO group_members (group_id,user_id) VALUES (?,?) ON DUPLICATE KEY UPDATE user_id=VALUES(user_id)",[rows[0].id,request.userId!]);
    if (!members.length) {
      const [joiningUsers] = await connection.query<RowDataPacket[]>('SELECT display_name FROM users WHERE id=?',[request.userId!]);
      const [commissioners] = await connection.query<RowDataPacket[]>(
        "SELECT u.id,u.email FROM group_members m JOIN users u ON u.id=m.user_id WHERE m.group_id=? AND m.role='commissioner'",[rows[0].id]);
      for (const commissioner of commissioners) {
        await queueEmail(connection,{
          kind:'member_joined',to:commissioner.email,userId:commissioner.id,groupId:rows[0].id,
          subject:"Huddle Pick'em: a new member joined your group",
          body:`${joiningUsers[0]?.display_name ?? 'A new player'} joined ${rows[0].name}.\n\nSign in and open My groups to view your members: ${config.APP_URL}`,
        });
      }
    }
    await connection.commit();
    response.json({id:rows[0].id});
  } catch(error) { await connection.rollback(); throw error; }
  finally { connection.release(); }
});

groupsRouter.patch('/:groupId/settings', requireGroup, requireCommissioner, async (request,response) => {
  const settings=z.object({requirePickApproval:z.boolean(),allowMultipleEntries:z.boolean(),joiningEnabled:z.boolean()}).parse(request.body);
  await pool.execute('UPDATE pool_groups SET require_pick_approval=?,allow_multiple_entries=?,joining_enabled=? WHERE id=?',
    [settings.requirePickApproval,settings.allowMultipleEntries,settings.joiningEnabled,request.groupId!]);
  response.json(settings);
});

groupsRouter.post('/:groupId/invite-code', requireGroup, requireCommissioner, async (request,response) => {
  const inviteCode=randomBytes(16).toString('hex');
  await pool.execute('UPDATE pool_groups SET invite_code=? WHERE id=?',[inviteCode,request.groupId!]);
  response.json({inviteCode});
});

groupsRouter.post('/:groupId/invitations', requireGroup, requireCommissioner, async (request,response) => {
  const {email}=z.object({email:z.string().trim().email().max(320).transform(value=>value.toLowerCase())}).parse(request.body);
  const db=await pool.getConnection();
  try {
    await db.beginTransaction();
    const [groups]=await db.query<RowDataPacket[]>('SELECT name,invite_code,joining_enabled FROM pool_groups WHERE id=? FOR UPDATE',[request.groupId!]);
    const group=groups[0];
    if(!group) throw new HttpError(404,'Group not found');
    if(!group.joining_enabled) throw new HttpError(409,'Enable new members joining before sending invitations');
    const [recent]=await db.query<RowDataPacket[]>(`SELECT id FROM email_outbox WHERE kind='invitation' AND group_id=? AND created_at>DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 1 HOUR)`,[request.groupId!]);
    if(recent.length>=20) throw new HttpError(429,'This group has sent 20 invitations this hour. Please try again later.');
    const [duplicate]=await db.query<RowDataPacket[]>(`SELECT id FROM email_outbox WHERE kind='invitation' AND group_id=? AND recipient=? AND created_at>DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 1 HOUR)`,[request.groupId!,email]);
    if(duplicate.length) throw new HttpError(429,'An invitation was already queued for this address within the last hour.');
    await queueEmail(db,{kind:'invitation',to:email,groupId:request.groupId!,expiresAt:new Date(Date.now()+7*86400000),
      subject:"You're invited to Huddle Pick'em",body:`You're invited to join ${group.name}!\n\nVisit ${config.APP_URL} and sign in or create an account. In My groups, enter this invite code:\n\n${group.invite_code}\n\nThis code works while the commissioner allows joining and keeps this invite code active.`});
    await db.commit();
    response.status(202).json({message:'Invitation queued for email delivery.'});
  } catch(error) {await db.rollback();throw error;} finally {db.release();}
});

groupsRouter.get('/:groupId/members', requireGroup, async (request,response) => {
  const canManage = request.groupRole === 'commissioner' || request.userRole === 'admin';
  const [rows] = await pool.query(
    `SELECT u.id,u.display_name AS displayName,m.role${canManage ? ',u.email' : ''} FROM group_members m
     JOIN users u ON u.id=m.user_id WHERE m.group_id=? ORDER BY m.role,u.display_name`,[request.groupId!],
  );
  response.json(rows);
});

groupsRouter.delete('/:groupId/members/:userId', requireGroup, requireCommissioner, async (request,response) => {
  const userId=z.coerce.number().int().positive().parse(request.params.userId);
  const db=await pool.getConnection();
  try {
    await db.beginTransaction();
    // Serialize with joining and other membership changes for this group.
    await db.query('SELECT id FROM pool_groups WHERE id=? FOR UPDATE',[request.groupId!]);
    const [members]=await db.query<RowDataPacket[]>('SELECT role FROM group_members WHERE group_id=? AND user_id=? FOR UPDATE',[request.groupId!,userId]);
    if(!members[0]) throw new HttpError(404,'This user is not a member of this group');
    if(members[0].role==='commissioner') throw new HttpError(409,'The group commissioner cannot be removed');
    await db.execute('DELETE FROM group_members WHERE group_id=? AND user_id=?',[request.groupId!,userId]);
    await db.execute("UPDATE email_outbox SET cancelled_at=UTC_TIMESTAMP(3) WHERE group_id=? AND user_id=? AND kind IN ('reminder','results') AND sent_at IS NULL AND cancelled_at IS NULL",[request.groupId!,userId]);
    await db.commit();
    response.json({message:'Member removed. Existing entries and results are preserved. They can rejoin with an active invite code.'});
  } catch(error) {await db.rollback();throw error;} finally {db.release();}
});
