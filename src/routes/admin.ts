import { Router } from "express";
import type { ResultSetHeader } from "mysql2";
import { z } from "zod";
import { pool } from "../db/pool.js";
import { requireAdmin, requireAuth } from "../middleware/auth.js";
import { scoreWeek } from "../services/score-week.js";
import { importScheduleCsv } from "../services/import-schedule.js";
import { HttpError } from "../lib/http-error.js";

export const adminRouter = Router();
adminRouter.use(requireAuth, requireAdmin);

adminRouter.get("/admin/teams", async (_request, response) => {
  const [rows] = await pool.query(
    "SELECT id, abbreviation, city, name, logo_url AS logoUrl FROM teams ORDER BY city, name",
  );
  response.json(rows);
});

adminRouter.get("/admin/pick-reviews", async (_request, response) => {
  const [rows] = await pool.query(
    `SELECT e.id AS entryId, e.entry_number AS entryNumber, u.display_name AS displayName, u.email, w.name AS weekName,
      e.tiebreaker_total AS tiebreakerTotal, e.submitted_at AS submittedAt,
      COUNT(p.game_id) AS pickCount
     FROM entries e JOIN users u ON u.id=e.user_id JOIN weeks w ON w.id=e.week_id
     LEFT JOIN picks p ON p.entry_id=e.id WHERE e.status='pending_review'
     GROUP BY e.id,e.entry_number,u.display_name,u.email,w.name,e.tiebreaker_total,e.submitted_at
     ORDER BY e.submitted_at ASC`,
  );
  response.json(rows);
});
adminRouter.post(
  "/admin/pick-reviews/:entryId/approve",
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
        "UPDATE entries SET status='submitted' WHERE id=? AND status='pending_review'",
        [entryId],
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
adminRouter.post(
  "/admin/pick-reviews/:entryId/reject",
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
        "UPDATE entries SET status='rejected' WHERE id=? AND status='pending_review'",
        [entryId],
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
adminRouter.post("/admin/teams", async (request, response) => {
  const body = z
    .object({
      abbreviation: z
        .string()
        .trim()
        .min(2)
        .max(5)
        .transform((v) => v.toUpperCase()),
      city: z.string().trim().min(1).max(100),
      name: z.string().trim().min(1).max(100),
      logoUrl: z.string().max(500).optional(),
    })
    .parse(request.body);
  const [result] = await pool.execute<ResultSetHeader>(
    "INSERT INTO teams (abbreviation, city, name, logo_url) VALUES (?, ?, ?, ?)",
    [body.abbreviation, body.city, body.name, body.logoUrl || null],
  );
  response.status(201).json({ id: result.insertId, ...body });
});
adminRouter.post("/admin/seasons", async (request, response) => {
  const body = z
    .object({
      year: z.number().int().min(2020).max(2100),
      name: z.string().trim().min(1).max(100),
    })
    .parse(request.body);
  const [result] = await pool.execute<ResultSetHeader>(
    "INSERT INTO seasons (year, name) VALUES (?, ?)",
    [body.year, body.name],
  );
  response.status(201).json({ id: result.insertId, ...body });
});
adminRouter.post("/admin/weeks", async (request, response) => {
  const body = z
    .object({
      seasonId: z.number().int().positive(),
      weekNumber: z.number().int().min(1).max(30),
      name: z.string().trim().min(1).max(100),
      picksLockAt: z.iso.datetime(),
      status: z.enum(["draft", "open"]).default("draft"),
    })
    .parse(request.body);
  const [result] = await pool.execute<ResultSetHeader>(
    "INSERT INTO weeks (season_id, week_number, name, picks_lock_at, status) VALUES (?, ?, ?, ?, ?)",
    [
      body.seasonId,
      body.weekNumber,
      body.name,
      new Date(body.picksLockAt),
      body.status,
    ],
  );
  response.status(201).json({ id: result.insertId });
});
adminRouter.post("/admin/games", async (request, response) => {
  const body = z
    .object({
      weekId: z.number().int().positive(),
      awayTeamId: z.number().int().positive(),
      homeTeamId: z.number().int().positive(),
      kickoffAt: z.iso.datetime(),
      isMondayTiebreaker: z.boolean().default(false),
    })
    .parse(request.body);
  const [result] = await pool.execute<ResultSetHeader>(
    "INSERT INTO games (week_id, away_team_id, home_team_id, kickoff_at, is_monday_tiebreaker) VALUES (?, ?, ?, ?, ?)",
    [
      body.weekId,
      body.awayTeamId,
      body.homeTeamId,
      new Date(body.kickoffAt),
      body.isMondayTiebreaker,
    ],
  );
  response.status(201).json({ id: result.insertId });
});
adminRouter.patch("/admin/games/:gameId/result", async (request, response) => {
  const gameId = z.coerce
    .number()
    .int()
    .positive()
    .parse(request.params.gameId);
  const body = z
    .object({
      awayScore: z.number().int().min(0).max(200),
      homeScore: z.number().int().min(0).max(200),
    })
    .parse(request.body);
  await pool.execute(
    "UPDATE games SET away_score=?, home_score=?, status='final' WHERE id=?",
    [body.awayScore, body.homeScore, gameId],
  );
  response.json({ id: gameId, status: "final" });
});
adminRouter.post("/admin/weeks/:weekId/score", async (request, response) => {
  const weekId = z.coerce
    .number()
    .int()
    .positive()
    .parse(request.params.weekId);
  response.json(await scoreWeek(weekId));
});
adminRouter.get("/admin/weeks/:weekId/pool", async (request, response) => {
  const weekId = z.coerce
    .number()
    .int()
    .positive()
    .parse(request.params.weekId);
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS paidEntries, COALESCE(SUM(p.gross_amount_cents),0) AS grossCents,
      COALESCE(SUM(p.processor_fee_cents),0) AS feeCents,
      COALESCE(SUM(COALESCE(p.net_amount_cents,p.gross_amount_cents)),0) AS prizePoolCents
     FROM payments p JOIN entries e ON e.id=p.entry_id WHERE e.week_id=? AND p.status='paid'`,
    [weekId],
  );
  response.json((rows as object[])[0]);
});

const importSchema = z.object({ season: z.number().int().min(2020).max(2100) });
adminRouter.post(
  "/admin/schedules/import-nflverse",
  async (request, response) => {
    const { season } = importSchema.parse(request.body);
    const sourceUrl =
      "https://github.com/nflverse/nflverse-data/releases/download/schedules/games.csv";
    const sourceResponse = await fetch(sourceUrl, {
      signal: AbortSignal.timeout(20_000),
    });
    if (!sourceResponse.ok)
      throw new Error(`Schedule source returned ${sourceResponse.status}`);
    const csv = await sourceResponse.text();
    if (csv.length > 5_000_000)
      throw new Error("Schedule source exceeded the expected size");
    response.json(
      await importScheduleCsv(
        csv,
        season,
        request.userId!,
        "nflverse schedules release",
      ),
    );
  },
);
adminRouter.post("/admin/schedules/import-csv", async (request, response) => {
  const body = importSchema
    .extend({ csv: z.string().min(20).max(5_000_000) })
    .parse(request.body);
  response.json(
    await importScheduleCsv(
      body.csv,
      body.season,
      request.userId!,
      "commissioner CSV upload",
    ),
  );
});
