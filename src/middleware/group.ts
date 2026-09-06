import type { RequestHandler } from 'express';
import type { RowDataPacket } from 'mysql2';
import { z } from 'zod';
import { pool } from '../db/pool.js';
import { HttpError } from '../lib/http-error.js';

export const requireGroup: RequestHandler = async (request, _response, next) => {
  try {
    const groupId = z.coerce.number().int().positive().parse(request.params.groupId);
    const [rows] = await pool.query<RowDataPacket[]>(
      'SELECT g.id,m.role FROM pool_groups g LEFT JOIN group_members m ON m.group_id=g.id AND m.user_id=? WHERE g.id=?',
      [request.userId,groupId],
    );
    if (!rows[0] || (!rows[0].role && request.userRole !== 'admin')) throw new HttpError(403,'Join this group to access it');
    request.groupId = groupId;
    request.groupRole = rows[0].role;
    next();
  } catch (error) { next(error); }
};

export const requireCommissioner: RequestHandler = (request, _response, next) => {
  if (request.groupRole !== 'commissioner' && request.userRole !== 'admin') {
    next(new HttpError(403,'Group commissioner access required'));
    return;
  }
  next();
};
