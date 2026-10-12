import type { PoolConnection } from 'mysql2/promise';
import type { RowDataPacket } from 'mysql2';
import { pool } from '../db/pool.js';
import { errorFields, logger } from '../lib/logger.js';
import { apnsConfigured, sendApns } from './apns.js';

type Database=Pick<PoolConnection,'execute'|'query'>;
export type PushCategory='reminders'|'review_requests'|'decisions'|'results'|'group_activity';

export async function queuePush(db:Database,message:{key:string;userId:number;category:PushCategory;title:string;body:string;groupId?:number;weekId?:number;entryId?:number;expiresAt?:Date}) {
  await db.execute(`INSERT INTO push_outbox (event_key,user_id,category,title,body,data,expires_at)
    VALUES (?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE event_key=VALUES(event_key)`,[
    message.key,message.userId,message.category,message.title.slice(0,150),message.body.replace(/\s+/g,' ').trim().slice(0,500),
    JSON.stringify({category:message.category,groupId:message.groupId,weekId:message.weekId,entryId:message.entryId}),message.expiresAt ?? null,
  ]);
  logger.info('push_queued',{category:message.category,userId:message.userId,groupId:message.groupId,weekId:message.weekId});
}

let running=false;
export async function processPushQueue():Promise<void> {
  if(running || !apnsConfigured())return;
  running=true;
  let db:PoolConnection|undefined,locked=false;
  try {
    db=await pool.getConnection();
    const [locks]=await db.query<RowDataPacket[]>("SELECT GET_LOCK(CONCAT('push:',LEFT(SHA2(DATABASE(),256),48)),0) AS acquired");
    locked=Number(locks[0]?.acquired)===1;
    if(!locked)return;
    await db.execute('UPDATE push_outbox SET cancelled_at=UTC_TIMESTAMP(3) WHERE sent_at IS NULL AND cancelled_at IS NULL AND expires_at IS NOT NULL AND expires_at<=UTC_TIMESTAMP(3)');
    const [messages]=await db.query<RowDataPacket[]>(`SELECT o.*,COALESCE(p.reminders,TRUE) reminders,COALESCE(p.review_requests,TRUE) review_requests,
      COALESCE(p.decisions,TRUE) decisions,COALESCE(p.results,TRUE) results,COALESCE(p.group_activity,TRUE) group_activity
      FROM push_outbox o LEFT JOIN push_preferences p ON p.user_id=o.user_id
      WHERE o.sent_at IS NULL AND o.cancelled_at IS NULL AND o.attempts<5 AND o.available_at<=UTC_TIMESTAMP(3) ORDER BY o.id LIMIT 10`);
    for(const message of messages) {
      if(!message[message.category]) {
        await db.execute('UPDATE push_outbox SET cancelled_at=UTC_TIMESTAMP(3) WHERE id=?',[message.id]);
        continue;
      }
      const [devices]=await db.query<RowDataPacket[]>('SELECT id,device_token FROM push_devices WHERE user_id=?',[message.user_id]);
      if(!devices.length) {
        await db.execute('UPDATE push_outbox SET cancelled_at=UTC_TIMESTAMP(3) WHERE id=?',[message.id]);
        continue;
      }
      await db.execute('UPDATE push_outbox SET attempts=attempts+1,available_at=DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 5 MINUTE) WHERE id=?',[message.id]);
      let delivered=false,transientFailure=false;
      for(const device of devices) {
        try {
          const result=await sendApns(device.device_token,{aps:{alert:{title:message.title,body:message.body},sound:'default'},...(typeof message.data==='string'?JSON.parse(message.data):message.data)});
          if(result.status===200) delivered=true;
          else if(result.status===410 || ['BadDeviceToken','Unregistered','DeviceTokenNotForTopic'].includes(result.reason ?? '')) await db.execute('DELETE FROM push_devices WHERE id=?',[device.id]);
          else {transientFailure=true;logger.warn('push_delivery_rejected',{queueId:message.id,status:result.status,reason:result.reason});}
        } catch(error) {transientFailure=true;logger.error('push_delivery_failed',{...errorFields(error),queueId:message.id});}
      }
      if(delivered) await db.execute('UPDATE push_outbox SET sent_at=UTC_TIMESTAMP(3) WHERE id=?',[message.id]);
      else if(!transientFailure || Number(message.attempts)+1>=5) await db.execute('UPDATE push_outbox SET cancelled_at=UTC_TIMESTAMP(3) WHERE id=?',[message.id]);
    }
  } catch(error) {logger.error('push_queue_processing_failed',errorFields(error));}
  finally {
    try {if(locked)await db?.query("SELECT RELEASE_LOCK(CONCAT('push:',LEFT(SHA2(DATABASE(),256),48)))");}
    finally {db?.release();running=false;}
  }
}
