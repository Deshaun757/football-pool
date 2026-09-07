import { randomUUID } from 'node:crypto';
import type { PoolConnection } from 'mysql2/promise';
import type { RowDataPacket } from 'mysql2';
import { pool } from '../db/pool.js';
import { config } from '../config.js';
import { sendEmail } from './email.js';
import { previousWeeksFinal } from './week-access.js';
import { errorFields, logger } from '../lib/logger.js';

type Database = Pick<PoolConnection, 'execute' | 'query'>;
export async function queueEmail(db:Database, message:{key?:string;to:string;subject:string;body:string;kind:string;userId?:number;groupId?:number;weekId?:number;expiresAt?:Date}) {
  await db.execute(`INSERT INTO email_outbox (event_key,recipient,subject,body,kind,user_id,group_id,week_id,expires_at)
    VALUES (?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE event_key=VALUES(event_key)`,
  [message.key ?? randomUUID(),message.to,message.subject,message.body,message.kind,message.userId ?? null,message.groupId ?? null,message.weekId ?? null,message.expiresAt ?? null]);
  logger.info('email_queued', { kind: message.kind, userId: message.userId, groupId: message.groupId, weekId: message.weekId });
}

export async function queuePickDecision(db:Database,entryId:number,decision:'approved'|'rejected',reason?:string) {
  const [rows]=await db.query<RowDataPacket[]>(`SELECT u.id,u.email,g.id AS groupId,g.name,w.name AS weekName,e.entry_number
    FROM entries e JOIN users u ON u.id=e.user_id JOIN pool_groups g ON g.id=e.group_id JOIN weeks w ON w.id=e.week_id WHERE e.id=?`,[entryId]);
  const row=rows[0];
  if(!row) throw new Error('Cannot queue email for a missing entry');
  await queueEmail(db,{to:row.email,kind:'pick_decision',userId:row.id,groupId:row.groupId,
    subject:`Huddle Pick'em: picks ${decision}`,
    body:`Your entry #${row.entry_number} for ${row.weekName} in ${row.name} was ${decision}.${reason ? `\n\nCommissioner's reason: ${reason}\nYou can update and resubmit before picks lock.` : ''}\n\nView your picks: ${config.APP_URL}`});
}

export async function queuePickReviewRequested(db:Database,entryId:number) {
  const [rows]=await db.query<RowDataPacket[]>(`SELECT e.id,e.entry_number,u.display_name AS playerName,g.id AS groupId,g.name AS groupName,w.id AS weekId,w.name AS weekName
    FROM entries e JOIN users u ON u.id=e.user_id JOIN pool_groups g ON g.id=e.group_id JOIN weeks w ON w.id=e.week_id WHERE e.id=?`,[entryId]);
  const entry=rows[0];
  if(!entry) throw new Error('Cannot queue review email for a missing entry');
  const [commissioners]=await db.query<RowDataPacket[]>(`SELECT u.id,u.email FROM group_members m JOIN users u ON u.id=m.user_id
    WHERE m.group_id=? AND m.role='commissioner'`,[entry.groupId]);
  for(const commissioner of commissioners) {
    await queueEmail(db,{kind:'pick_review_requested',to:commissioner.email,userId:commissioner.id,groupId:entry.groupId,weekId:entry.weekId,
      subject:"Huddle Pick'em: picks are ready for review",
      body:`${entry.playerName} submitted entry #${entry.entry_number} for ${entry.weekName} in ${entry.groupName}.\n\nReview the picks in Group commissioner: ${config.APP_URL}`});
  }
}

export async function queueReminders(db:Database) {
  const [rows]=await db.query<RowDataPacket[]>(`SELECT u.id,u.email,g.id AS groupId,g.name,w.id AS weekId,w.name AS weekName,w.picks_lock_at
    FROM group_members m JOIN users u ON u.id=m.user_id JOIN pool_groups g ON g.id=m.group_id
    JOIN weeks w ON w.status='open' AND w.picks_lock_at>UTC_TIMESTAMP(3) AND w.picks_lock_at<=DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 24 HOUR)
    WHERE u.reminder_emails=TRUE AND ${previousWeeksFinal('w')} AND EXISTS (SELECT 1 FROM games WHERE week_id=w.id)
    AND NOT EXISTS (SELECT 1 FROM entries e WHERE e.user_id=u.id AND e.group_id=g.id AND e.week_id=w.id AND e.status IN ('submitted','pending_review'))`);
  for(const row of rows) await queueEmail(db,{key:`reminder:${row.groupId}:${row.weekId}:${row.id}`,kind:'reminder',to:row.email,userId:row.id,groupId:row.groupId,weekId:row.weekId,expiresAt:row.picks_lock_at,
    subject:"Huddle Pick'em: picks close soon",body:`Remember to submit your ${row.weekName} picks for ${row.name}.\n\nPicks lock at ${new Date(row.picks_lock_at).toISOString()} (UTC).\n\nMake your picks: ${config.APP_URL}`});
}

let running=false;
export async function processEmailQueue():Promise<void> {
  if(running) return;
  running=true;
  let db:PoolConnection|undefined;
  let locked=false;
  try {
    db=await pool.getConnection();
    const [locks]=await db.query<RowDataPacket[]>("SELECT GET_LOCK(CONCAT('mail:',LEFT(SHA2(DATABASE(),256),48)),0) AS acquired");
    locked=Number(locks[0]?.acquired)===1;
    if(!locked) return;
    await queueReminders(db);
    await db.execute(`UPDATE email_outbox SET cancelled_at=UTC_TIMESTAMP(3) WHERE sent_at IS NULL AND cancelled_at IS NULL
      AND expires_at IS NOT NULL AND expires_at<=UTC_TIMESTAMP(3)`);
    const [messages]=await db.query<RowDataPacket[]>(`SELECT * FROM email_outbox WHERE sent_at IS NULL AND cancelled_at IS NULL
      AND attempts<5 AND available_at<=UTC_TIMESTAMP(3) ORDER BY id LIMIT 10`);
    for(const message of messages) {
      if(message.user_id && ['reminder','results'].includes(message.kind)) {
        const [users]=await db.query<RowDataPacket[]>('SELECT reminder_emails,result_emails FROM users WHERE id=?',[message.user_id]);
        if(!users[0] || !(message.kind==='reminder'?users[0].reminder_emails:users[0].result_emails)) {
          await db.execute('UPDATE email_outbox SET cancelled_at=UTC_TIMESTAMP(3) WHERE id=?',[message.id]);
          logger.info('email_cancelled_by_preference', { queueId: message.id, kind: message.kind, userId: message.user_id });
          continue;
        }
      }
      if(message.kind==='reminder') {
        const [eligible]=await db.query<RowDataPacket[]>(`SELECT m.user_id FROM group_members m JOIN weeks w ON w.id=?
          WHERE m.group_id=? AND m.user_id=? AND w.status='open' AND w.picks_lock_at>UTC_TIMESTAMP(3) AND ${previousWeeksFinal('w')}
          AND NOT EXISTS (SELECT 1 FROM entries e WHERE e.user_id=m.user_id AND e.group_id=m.group_id AND e.week_id=w.id AND e.status IN ('submitted','pending_review'))`,[message.week_id,message.group_id,message.user_id]);
        if(!eligible.length) {
          await db.execute('UPDATE email_outbox SET cancelled_at=UTC_TIMESTAMP(3) WHERE id=?',[message.id]);
          logger.info('email_cancelled_not_eligible', { queueId: message.id, kind: message.kind, userId: message.user_id, groupId: message.group_id, weekId: message.week_id });
          continue;
        }
      }
      // Persist an attempt first so crashes cannot cause an endless retry loop.
      await db.execute('UPDATE email_outbox SET attempts=attempts+1,available_at=DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 5 MINUTE) WHERE id=?',[message.id]);
      try {
        const footer=['reminder','results'].includes(message.kind)?`\n\nManage email preferences: ${new URL('/support.html',config.APP_URL)}`:'';
        await sendEmail(message.recipient,message.subject,message.body+footer,`<${message.event_key}@${new URL(config.APP_URL).hostname}>`);
        await db.execute('UPDATE email_outbox SET sent_at=UTC_TIMESTAMP(3) WHERE id=?',[message.id]);
        logger.info('email_sent', { queueId: message.id, kind: message.kind, attempt: Number(message.attempts) + 1 });
      } catch (error) {
        logger.error('email_delivery_failed', { ...errorFields(error), queueId: message.id, kind: message.kind, attempt: Number(message.attempts) + 1, maxAttempts: 5 });
      }
    }
  } catch (error) { logger.error('email_queue_processing_failed', errorFields(error)); }
  finally {
    try { if(locked) await db?.query("SELECT RELEASE_LOCK(CONCAT('mail:',LEFT(SHA2(DATABASE(),256),48)))"); }
    finally { db?.release(); running=false; }
  }
}

export function startEmailWorker() {
  void processEmailQueue();
  const timer=setInterval(()=>{void processEmailQueue();},60_000);
  timer.unref();
  return timer;
}
