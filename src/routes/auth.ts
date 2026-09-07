import { createHash, randomBytes } from 'node:crypto';
import { Router } from 'express';
import type { ResultSetHeader, RowDataPacket } from 'mysql2';
import { z } from 'zod';
import { config } from '../config.js';
import { pool } from '../db/pool.js';
import { parseCookies } from '../lib/cookies.js';
import { HttpError } from '../lib/http-error.js';
import { hashPassword, verifyPassword } from '../lib/password.js';
import { requireAuth } from '../middleware/auth.js';
import { passwordPair } from '../lib/password-policy.js';
import { displayNameSchema } from '../lib/name-policy.js';
import { sendPasswordReset } from '../services/email.js';
import { queueEmail } from '../services/email-outbox.js';
import { rateLimit } from 'express-rate-limit';
import { errorFields, logger } from '../lib/logger.js';

const credentials = z.object({ email: z.string().email().max(320).transform((v) => v.toLowerCase()), password: z.string().min(10).max(200) });
const registerSchema = passwordPair.safeExtend({email:credentials.shape.email, displayName: displayNameSchema, acceptTerms:z.literal(true) });
type UserRow = RowDataPacket & { id: number; email: string; display_name: string; password_hash: string | null; role: 'player' | 'admin' };

export const authRouter = Router();
const recoveryLimit=rateLimit({windowMs:15*60*1000,limit:10,standardHeaders:'draft-8',legacyHeaders:false,message:{error:'Too many password recovery attempts. Try again in 15 minutes.'}});
const recoveryMessage='If an account exists for that email, a password reset link has been sent.';

authRouter.post('/forgot-password', recoveryLimit, async (request,response)=>{
  const {email}=z.object({email:credentials.shape.email}).parse(request.body);
  const connection=await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [users]=await connection.query<UserRow[]>('SELECT id,password_hash FROM users WHERE email=? FOR UPDATE',[email]);
    const user=users[0];
    if (user?.password_hash) {
      const [recent]=await connection.query<RowDataPacket[]>('SELECT user_id FROM password_resets WHERE user_id=? AND created_at>DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 1 MINUTE)',[user.id]);
      if (!recent.length) {
        const token=randomBytes(32).toString('hex');
        await connection.execute(`INSERT INTO password_resets (user_id,token_hash,expires_at) VALUES (?,?,DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 30 MINUTE))
          ON DUPLICATE KEY UPDATE token_hash=VALUES(token_hash),expires_at=VALUES(expires_at),created_at=UTC_TIMESTAMP(3)`,[user.id,createHash('sha256').update(token).digest()]);
        await sendPasswordReset(email,token);
      }
    }
    await connection.commit();
  } catch(error) {
    await connection.rollback();
    // Never log reset links or reveal whether an email belongs to an account.
    logger.error('password_recovery_failed', errorFields(error));
  } finally { connection.release(); }
  response.json({message:recoveryMessage});
});

authRouter.post('/reset-password', recoveryLimit, async (request,response)=>{
  const body=passwordPair.safeExtend({token:z.string().regex(/^[a-f0-9]{64}$/)}).parse(request.body);
  const tokenHash=createHash('sha256').update(body.token).digest();
  const [tokens]=await pool.query<RowDataPacket[]>('SELECT user_id FROM password_resets WHERE token_hash=? AND expires_at>UTC_TIMESTAMP(3)',[tokenHash]);
  if (!tokens[0]) throw new HttpError(400,'This reset link is invalid or expired. Request a new one.');
  const passwordHash=await hashPassword(body.password);
  const connection=await pool.getConnection();
  try {
    await connection.beginTransaction();
    const userId=Number(tokens[0].user_id);
    await connection.query('SELECT id FROM users WHERE id=? FOR UPDATE',[userId]);
    const [valid]=await connection.query<RowDataPacket[]>('SELECT user_id FROM password_resets WHERE user_id=? AND token_hash=? AND expires_at>UTC_TIMESTAMP(3) FOR UPDATE',[userId,tokenHash]);
    if (!valid.length) throw new HttpError(400,'This reset link is invalid or expired. Request a new one.');
    await connection.execute('UPDATE users SET password_hash=? WHERE id=?',[passwordHash,userId]);
    await connection.execute('DELETE FROM password_resets WHERE user_id=?',[userId]);
    await connection.execute('DELETE FROM sessions WHERE user_id=?',[userId]);
    await connection.commit();
    response.clearCookie(config.SESSION_COOKIE_NAME,{path:'/'});
    response.json({message:'Password changed. Sign in with your new password.'});
  } catch(error) { await connection.rollback(); throw error; }
  finally { connection.release(); }
});

function setSessionCookie(response: import('express').Response, token: string): void {
  response.cookie(config.SESSION_COOKIE_NAME, token, {
    httpOnly: true, secure: config.NODE_ENV === 'production', sameSite: 'strict',
    maxAge: config.SESSION_TTL_DAYS * 86_400_000, path: '/'
  });
}

async function createSession(userId: number): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  const hash = createHash('sha256').update(token).digest();
  await pool.execute('INSERT INTO sessions (user_id, token_hash, expires_at) VALUES (?, ?, DATE_ADD(UTC_TIMESTAMP(3), INTERVAL ? DAY))', [userId, hash, config.SESSION_TTL_DAYS]);
  return token;
}

authRouter.post('/register', async (request, response) => {
  const body = registerSchema.parse(request.body);
  const passwordHash = await hashPassword(body.password);
  const role = config.ADMIN_EMAIL?.toLowerCase() === body.email ? 'admin' : 'player';
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [result] = await connection.execute<ResultSetHeader>(`INSERT INTO users (email, display_name, password_hash, role,terms_version,terms_accepted_at) VALUES (?, ?, ?, ?,'2026-09-06',UTC_TIMESTAMP(3))`, [body.email, body.displayName, passwordHash, role]);
    await queueEmail(connection,{key:`welcome:${result.insertId}`,kind:'welcome',to:body.email,userId:result.insertId,
      subject:"Welcome to Huddle Pick'em!",body:`Hi ${body.displayName},\n\nYour account is ready. Create a group to become its commissioner, or join a group with an invite code.\n\nGet started: ${config.APP_URL}`});
    await connection.commit();
    setSessionCookie(response, await createSession(result.insertId));
    response.status(201).json({ id: result.insertId, email: body.email, displayName: body.displayName, role });
  } catch (error: unknown) {
    await connection.rollback();
    if ((error as { code?: string }).code === 'ER_DUP_ENTRY') throw new HttpError(409, 'An account already exists for that email');
    throw error;
  } finally { connection.release(); }
});

authRouter.post('/login', async (request, response) => {
  const body = credentials.parse(request.body);
  const [rows] = await pool.query<UserRow[]>('SELECT id, email, display_name, password_hash, role FROM users WHERE email = ?', [body.email]);
  const user = rows[0];
  if (!user?.password_hash || !await verifyPassword(body.password, user.password_hash)) throw new HttpError(401, 'Invalid email or password');
  setSessionCookie(response, await createSession(user.id));
  response.json({ id: user.id, email: user.email, displayName: user.display_name, role: user.role });
});

authRouter.post('/logout', requireAuth, async (request, response) => {
  const token = parseCookies(request.header('cookie'))[config.SESSION_COOKIE_NAME];
  if (token) await pool.execute('DELETE FROM sessions WHERE token_hash = ?', [createHash('sha256').update(token).digest()]);
  response.clearCookie(config.SESSION_COOKIE_NAME, { path: '/' });
  response.status(204).end();
});

authRouter.patch('/me', requireAuth, async (request, response) => {
  const {displayName} = z.object({displayName: displayNameSchema}).parse(request.body);
  await pool.execute('UPDATE users SET display_name=? WHERE id=?', [displayName, request.userId!]);
  const [rows] = await pool.query<UserRow[]>('SELECT id, email, display_name, role FROM users WHERE id = ?', [request.userId!]);
  const user = rows[0]!;
  response.json({ id: user.id, email: user.email, displayName: user.display_name, role: user.role });
});

// A logged-out or expired session is a normal result of the browser's session check.
authRouter.get('/me', (request, response, next) => {
  void requireAuth(request, response, (error?: unknown) => {
    if (error instanceof HttpError && error.status === 401) {
      response.json(null);
      return;
    }
    next(error);
  });
}, async (request, response) => {
  const [rows] = await pool.query<UserRow[]>('SELECT id, email, display_name, role FROM users WHERE id = ?', [request.userId]);
  const user = rows[0]!;
  response.json({ id: user.id, email: user.email, displayName: user.display_name, role: user.role });
});
