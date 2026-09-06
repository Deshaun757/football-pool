import { randomBytes } from 'node:crypto';
import { Router } from 'express';
import type { ResultSetHeader, RowDataPacket } from 'mysql2';
import { z } from 'zod';
import { pool } from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';
import { requireGroup, requireCommissioner } from '../middleware/group.js';
import { HttpError } from '../lib/http-error.js';

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
    const [rows] = await connection.query<RowDataPacket[]>('SELECT id,joining_enabled FROM pool_groups WHERE invite_code=? FOR UPDATE',[inviteCode]);
    if (!rows[0]) throw new HttpError(404,'Invite code not found');
    const [members] = await connection.query<RowDataPacket[]>('SELECT user_id FROM group_members WHERE group_id=? AND user_id=?',[rows[0].id,request.userId!]);
    if (!members.length && !rows[0].joining_enabled) throw new HttpError(409,'This group is not accepting new members');
    await connection.execute("INSERT INTO group_members (group_id,user_id) VALUES (?,?) ON DUPLICATE KEY UPDATE user_id=VALUES(user_id)",[rows[0].id,request.userId!]);
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

groupsRouter.get('/:groupId/members', requireGroup, async (request,response) => {
  const [rows] = await pool.query(
    `SELECT u.id,u.display_name AS displayName,m.role FROM group_members m
     JOIN users u ON u.id=m.user_id WHERE m.group_id=? ORDER BY m.role,u.display_name`,[request.groupId!],
  );
  response.json(rows);
});
