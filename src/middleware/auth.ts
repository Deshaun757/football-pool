import { createHash } from 'node:crypto';
import type { RequestHandler } from 'express';
import type { RowDataPacket } from 'mysql2';
import { config } from '../config.js';
import { pool } from '../db/pool.js';
import { parseCookies } from '../lib/cookies.js';
import { HttpError } from '../lib/http-error.js';

type SessionRow = RowDataPacket & { user_id: number; role: 'player' | 'admin' };

export const requireAuth: RequestHandler = async (request, _response, next) => {
  try {
    const token = parseCookies(request.header('cookie'))[config.SESSION_COOKIE_NAME];
    if (!token) throw new HttpError(401, 'Authentication required');
    const tokenHash = createHash('sha256').update(token).digest();
    const [rows] = await pool.query<SessionRow[]>(
      `SELECT s.user_id, u.role FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ? AND s.expires_at > UTC_TIMESTAMP(3)`, [tokenHash]
    );
    const session = rows[0];
    if (!session) throw new HttpError(401, 'Session expired');
    request.userId = session.user_id;
    request.userRole = session.role;
    next();
  } catch (error) { next(error); }
};

export const requireAdmin: RequestHandler = (request, _response, next) => {
  if (request.userRole !== 'admin') { next(new HttpError(403, 'Administrator access required')); return; }
  next();
};
