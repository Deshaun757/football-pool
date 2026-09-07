import { Router } from "express";
import { z } from "zod";
import type { RowDataPacket } from "mysql2";
import { pool } from "../db/pool.js";
import { requireAuth, requireAdmin } from "../middleware/auth.js";
import { HttpError } from "../lib/http-error.js";

export const supportRouter = Router();
supportRouter.use(requireAuth);
supportRouter.get("/preferences", async (request, response) => {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT reminder_emails,result_emails FROM users WHERE id=?",
    [request.userId!],
  );
  response.json({
    reminders: !!rows[0]?.reminder_emails,
    results: !!rows[0]?.result_emails,
  });
});
supportRouter.patch("/preferences", async (request, response) => {
  const body = z
    .object({ reminders: z.boolean(), results: z.boolean() })
    .parse(request.body);
  await pool.execute(
    "UPDATE users SET reminder_emails=?,result_emails=? WHERE id=?",
    [body.reminders, body.results, request.userId!],
  );
  response.json(body);
});
supportRouter.post("/requests", async (request, response) => {
  const body = z
    .object({
      category: z.enum([
        "support",
        "access",
        "correction",
        "deletion",
        "privacy",
      ]),
      message: z.string().trim().min(10).max(4000),
    })
    .parse(request.body);
  const db = await pool.getConnection();
  try {
    await db.beginTransaction();
    await db.query("SELECT id FROM users WHERE id=? FOR UPDATE", [
      request.userId!,
    ]);
    const [recent] = await db.query<RowDataPacket[]>(
      "SELECT id FROM support_requests WHERE user_id=? AND created_at>DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 1 DAY)",
      [request.userId!],
    );
    if (recent.length >= 5)
      throw new HttpError(429, "You can submit up to five requests per day.");
    await db.execute(
      "INSERT INTO support_requests (user_id,category,message) VALUES (?,?,?)",
      [request.userId!, body.category, body.message],
    );
    await db.commit();
    response
      .status(201)
      .json({
        message:
          "Your request is recorded for the app administrator. You can track its status below. Deletion requests require review; submitting does not immediately delete your account.",
      });
  } catch (error) {
    await db.rollback();
    throw error;
  } finally {
    db.release();
  }
});
supportRouter.get("/requests", async (request, response) => {
  const [rows] = await pool.query(
    "SELECT id,category,message,status,created_at FROM support_requests WHERE user_id=? ORDER BY id DESC",
    [request.userId!],
  );
  response.json(rows);
});
supportRouter.get(
  "/admin/requests",
  requireAdmin,
  async (_request, response) => {
    const [rows] =
      await pool.query(`SELECT r.id,r.category,r.message,r.status,r.created_at,u.email,u.display_name
    FROM support_requests r JOIN users u ON u.id=r.user_id ORDER BY r.status='open' DESC,r.id DESC LIMIT 200`);
    response.json(rows);
  },
);
supportRouter.patch(
  "/admin/requests/:id",
  requireAdmin,
  async (request, response) => {
    const id = z.coerce.number().int().positive().parse(request.params.id);
    const { status } = z
      .object({ status: z.enum(["open", "resolved"]) })
      .parse(request.body);
    await pool.execute(
      "UPDATE support_requests SET status=?,resolved_at=IF(?='resolved',UTC_TIMESTAMP(3),NULL) WHERE id=?",
      [status, status, id],
    );
    response.json({ status });
  },
);
