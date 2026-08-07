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

const credentials = z.object({ email: z.string().email().max(320).transform((v) => v.toLowerCase()), password: z.string().min(10).max(200) });
const registerSchema = credentials.extend({ displayName: z.string().trim().min(2).max(100) });
type UserRow = RowDataPacket & { id: number; email: string; display_name: string; password_hash: string | null; role: 'player' | 'admin' };

export const authRouter = Router();

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
  try {
    const [result] = await pool.execute<ResultSetHeader>('INSERT INTO users (email, display_name, password_hash, role) VALUES (?, ?, ?, ?)', [body.email, body.displayName, passwordHash, role]);
    setSessionCookie(response, await createSession(result.insertId));
    response.status(201).json({ id: result.insertId, email: body.email, displayName: body.displayName, role });
  } catch (error: unknown) {
    if ((error as { code?: string }).code === 'ER_DUP_ENTRY') throw new HttpError(409, 'An account already exists for that email');
    throw error;
  }
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

authRouter.get('/me', requireAuth, async (request, response) => {
  const [rows] = await pool.query<UserRow[]>('SELECT id, email, display_name, role FROM users WHERE id = ?', [request.userId]);
  const user = rows[0]!;
  response.json({ id: user.id, email: user.email, displayName: user.display_name, role: user.role });
});
