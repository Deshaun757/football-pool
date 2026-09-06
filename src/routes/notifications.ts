import { Router } from "express";
import type { RowDataPacket } from "mysql2";
import { pool } from "../db/pool.js";

type CountRow = RowDataPacket & { unreadCount: number };

export const notificationsRouter = Router();


notificationsRouter.get("/notifications", async (request, response) => {
  const userId = request.userId!;
  const [rows] = await pool.query(
    `SELECT n.id, n.type, n.message, n.read_at AS readAt, n.created_at AS createdAt,
      n.entry_id AS entryId, w.id AS weekId, w.name AS weekName, e.entry_number AS entryNumber
     FROM notifications n LEFT JOIN entries e ON e.id=n.entry_id LEFT JOIN weeks w ON w.id=e.week_id
     WHERE n.user_id=? AND e.group_id=? ORDER BY n.created_at DESC LIMIT 100`,
    [userId, request.groupId!],
  );
  const [counts] = await pool.query<CountRow[]>(
    "SELECT COUNT(*) AS unreadCount FROM notifications n JOIN entries e ON e.id=n.entry_id WHERE n.user_id=? AND e.group_id=? AND n.read_at IS NULL",
    [userId, request.groupId!],
  );
  response.json({
    unreadCount: Number(counts[0]?.unreadCount ?? 0),
    notifications: rows,
  });
});

notificationsRouter.post(
  "/notifications/read-all",
  async (request, response) => {
    const userId = request.userId!;
    await pool.execute(
      "UPDATE notifications n JOIN entries e ON e.id=n.entry_id SET n.read_at=UTC_TIMESTAMP(3) WHERE n.user_id=? AND e.group_id=? AND n.read_at IS NULL",
      [userId, request.groupId!],
    );
    response.status(204).end();
  },
);
