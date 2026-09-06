import { Router } from 'express';
import type { ResultSetHeader } from 'mysql2';
import { z } from 'zod';
import { pool } from '../db/pool.js';
import { requireCommissioner } from '../middleware/group.js';
import { HttpError } from '../lib/http-error.js';
export const reviewsRouter = Router();
reviewsRouter.use('/reviews', requireCommissioner);
reviewsRouter.get("/reviews", async (request, response) => {
  const [rows] = await pool.query(
    `SELECT e.id AS entryId, e.entry_number AS entryNumber, u.display_name AS displayName, u.email, w.name AS weekName,
      e.tiebreaker_total AS tiebreakerTotal, e.submitted_at AS submittedAt,
      COUNT(p.game_id) AS pickCount
     FROM entries e JOIN users u ON u.id=e.user_id JOIN weeks w ON w.id=e.week_id
     LEFT JOIN picks p ON p.entry_id=e.id WHERE e.status='pending_review' AND e.group_id=?
     GROUP BY e.id,e.entry_number,u.display_name,u.email,w.name,e.tiebreaker_total,e.submitted_at
     ORDER BY e.submitted_at ASC`,
    [request.groupId!],
  );
  response.json(rows);
});
reviewsRouter.post(
  "/reviews/:entryId/approve",
  async (request, response) => {
    const entryId = z.coerce
      .number()
      .int()
      .positive()
      .parse(request.params.entryId);
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [result] = await connection.execute<ResultSetHeader>(
        "UPDATE entries SET status='submitted' WHERE id=? AND group_id=? AND status='pending_review'",
        [entryId, request.groupId!],
      );
      if (!result.affectedRows)
        throw new HttpError(409, "Entry is no longer pending review");
      await connection.execute(
        "UPDATE notifications SET read_at=UTC_TIMESTAMP(3) WHERE entry_id=? AND type='pick_review_requested'",
        [entryId],
      );
      await connection.execute(
        `INSERT INTO notifications (user_id,entry_id,type,message)
       SELECT user_id,id,'entry_approved','Your picks were approved' FROM entries WHERE id=?
       ON DUPLICATE KEY UPDATE message=VALUES(message),read_at=NULL,created_at=CURRENT_TIMESTAMP(3)`,
        [entryId],
      );
      await connection.commit();
      response.json({ entryId, status: "submitted" });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  },
);
reviewsRouter.post(
  "/reviews/:entryId/reject",
  async (request, response) => {
    const entryId = z.coerce
      .number()
      .int()
      .positive()
      .parse(request.params.entryId);
    const body = z
      .object({ reason: z.string().trim().min(3).max(300) })
      .parse(request.body);
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [result] = await connection.execute<ResultSetHeader>(
        "UPDATE entries SET status='rejected' WHERE id=? AND group_id=? AND status='pending_review'",
        [entryId, request.groupId!],
      );
      if (!result.affectedRows)
        throw new HttpError(409, "Entry is no longer pending review");
      await connection.execute(
        "UPDATE notifications SET read_at=UTC_TIMESTAMP(3) WHERE entry_id=? AND type='pick_review_requested'",
        [entryId],
      );
      await connection.execute(
        `INSERT INTO notifications (user_id,entry_id,type,message)
       SELECT user_id,id,'entry_rejected',? FROM entries WHERE id=?
       ON DUPLICATE KEY UPDATE message=VALUES(message),read_at=NULL,created_at=CURRENT_TIMESTAMP(3)`,
        [`Picks need changes: ${body.reason}`, entryId],
      );
      await connection.commit();
      response.json({ entryId, status: "rejected" });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  },
);
