import { Router } from 'express';
import { z } from 'zod';
import type { RowDataPacket } from 'mysql2';
import { pool } from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';
import { config } from '../config.js';

export const pushRouter=Router();
pushRouter.use(requireAuth);

const tokenSchema=z.string().trim().regex(/^[a-f0-9]{64,255}$/i);
const preferencesSchema=z.object({
  reminders:z.boolean(),reviewRequests:z.boolean(),decisions:z.boolean(),results:z.boolean(),groupActivity:z.boolean(),
});

pushRouter.get('/preferences',async(request,response)=>{
  const [rows]=await pool.query<RowDataPacket[]>(`SELECT reminders,review_requests AS reviewRequests,decisions,results,group_activity AS groupActivity
    FROM push_preferences WHERE user_id=?`,[request.userId!]);
  response.json({configured:!!(config.APPLE_TEAM_ID && config.APNS_KEY_ID && config.APNS_PRIVATE_KEY_BASE64),
    preferences:rows[0] ?? {reminders:true,reviewRequests:true,decisions:true,results:true,groupActivity:true}});
});

pushRouter.put('/preferences',async(request,response)=>{
  const values=preferencesSchema.parse(request.body);
  await pool.execute(`INSERT INTO push_preferences (user_id,reminders,review_requests,decisions,results,group_activity) VALUES (?,?,?,?,?,?)
    ON DUPLICATE KEY UPDATE reminders=VALUES(reminders),review_requests=VALUES(review_requests),decisions=VALUES(decisions),results=VALUES(results),group_activity=VALUES(group_activity)`,
  [request.userId!,values.reminders,values.reviewRequests,values.decisions,values.results,values.groupActivity]);
  response.json(values);
});

pushRouter.post('/devices',async(request,response)=>{
  if(request.get('x-huddle-client')!=='ios') {response.status(400).json({error:'Push devices can only be registered from the iOS app'});return;}
  const {token}=z.object({token:tokenSchema}).parse(request.body);
  await pool.execute(`INSERT INTO push_devices (user_id,platform,device_token) VALUES (?,'ios',?)
    ON DUPLICATE KEY UPDATE user_id=VALUES(user_id),platform='ios',updated_at=UTC_TIMESTAMP(3)`,[request.userId!,token]);
  response.status(204).end();
});

pushRouter.post('/devices/unregister',async(request,response)=>{
  const {token}=z.object({token:tokenSchema}).parse(request.body);
  await pool.execute('DELETE FROM push_devices WHERE user_id=? AND device_token=?',[request.userId!,token]);
  response.status(204).end();
});
