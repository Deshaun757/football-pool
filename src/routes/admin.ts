import { Router } from "express";
import type { ResultSetHeader } from "mysql2";
import { z } from "zod";
import { pool } from "../db/pool.js";
import { requireAdmin, requireAuth } from "../middleware/auth.js";
import { scoreWeek } from "../services/score-week.js";
import { importScheduleCsv } from "../services/import-schedule.js";
import { fetchScheduleCsv } from "../services/fetch-schedule.js";
import { HttpError } from "../lib/http-error.js";

export const adminRouter = Router();
adminRouter.use('/admin', requireAuth, requireAdmin);

adminRouter.get('/admin/users', async (request,response) => {
  const {page,q}=z.object({page:z.coerce.number().int().min(1).max(1000000).default(1),q:z.string().trim().max(100).default('')}).parse(request.query);
  const filter=`%${q}%`;
  const [users]=await pool.query(`SELECT u.id,u.display_name AS displayName,u.email,u.role,u.created_at AS createdAt,
    (SELECT COUNT(*) FROM group_members m WHERE m.user_id=u.id) AS groupCount
    FROM users u WHERE u.display_name LIKE ? OR u.email LIKE ? ORDER BY u.created_at DESC,u.id DESC LIMIT 50 OFFSET ?`,[filter,filter,(page-1)*50]);
  const [counts]=await pool.query<import('mysql2').RowDataPacket[]>('SELECT COUNT(*) AS total FROM users WHERE display_name LIKE ? OR email LIKE ?',[filter,filter]);
  response.json({users,total:Number(counts[0]?.total ?? 0),page,pageSize:50});
});

adminRouter.get("/admin/teams", async (_request, response) => {
  const [rows] = await pool.query(
    "SELECT id, abbreviation, city, name, logo_url AS logoUrl FROM teams ORDER BY city, name",
  );
  response.json(rows);
});

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
const importSchema = z.object({ season: z.number().int().min(2020).max(2100) });
adminRouter.post(
  "/admin/schedules/import-nflverse",
  async (request, response) => {
    const { season } = importSchema.parse(request.body);
    const csv = await fetchScheduleCsv();
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
