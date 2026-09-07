import { Router } from "express";
import { queuePickDecision, queuePickReviewRequested } from '../services/email-outbox.js';
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { z } from "zod";
import { pool } from "../db/pool.js";
import { HttpError } from "../lib/http-error.js";
import { validatePicks } from "../services/entry-validation.js";
import { requirePreviousWeeksFinal } from '../services/week-access.js';

const saveSchema = z.object({
  entryId: z.number().int().positive().optional(),
  tiebreakerTotal: z.number().int().min(0).max(200),
  picks: z.array(
    z.object({
      gameId: z.number().int().positive(),
      teamId: z.number().int().positive(),
    }),
  ),
});

type WeekRow = RowDataPacket & {
  id: number;
  status: string;
  picks_lock_at: Date;
};
type GameRow = RowDataPacket & {
  id: number;
  home_team_id: number;
  away_team_id: number;
};
type EntryRow = RowDataPacket & {
  id: number;
  status: string;
  tiebreaker_total: number | null;
  entry_number?: number;
};

export const entriesRouter = Router();


entriesRouter.put("/weeks/:weekId/entry", async (request, response) => {
  const userId = request.userId!;
  const weekId = z.coerce
    .number()
    .int()
    .positive()
    .parse(request.params.weekId);
  const body = saveSchema.parse(request.body);
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [settings] = await connection.query<RowDataPacket[]>('SELECT max_entries_per_member FROM pool_groups WHERE id=? FOR UPDATE',[request.groupId!]);
    const [weeks] = await connection.query<WeekRow[]>(
      "SELECT id, status, picks_lock_at FROM weeks WHERE id = ? FOR UPDATE",
      [weekId],
    );
    const week = weeks[0];
    if (!week || week.status !== "open" || week.picks_lock_at <= new Date())
      throw new HttpError(409, "Picks are closed for this week");
    await requirePreviousWeeksFinal(connection,weekId);

    const [games] = await connection.query<GameRow[]>(
      "SELECT id, home_team_id, away_team_id FROM games WHERE week_id = ?",
      [weekId],
    );
    validatePicks(
      games.map((game) => ({
        id: game.id,
        homeTeamId: game.home_team_id,
        awayTeamId: game.away_team_id,
      })),
      body.picks,
    );

    let entry: EntryRow | undefined;
    if (body.entryId) {
      const [entries] = await connection.query<EntryRow[]>(
        "SELECT id,status,tiebreaker_total,entry_number FROM entries WHERE id=? AND user_id=? AND week_id=? AND group_id=? FOR UPDATE",
        [body.entryId, userId, weekId, request.groupId!],
      );
      entry = entries[0];
      if (entry && ["draft", "rejected"].includes(entry.status)) {
        await connection.execute(
          "UPDATE entries SET tiebreaker_total=?,status='draft' WHERE id=?",
          [body.tiebreakerTotal, entry.id],
        );
        entry.status = "draft";
      }
    } else {
      const [numberRows] = await connection.query<
        (RowDataPacket & { next_number: number })[]
      >(
        "SELECT COALESCE(MAX(entry_number),0)+1 AS next_number FROM entries WHERE user_id=? AND week_id=? AND group_id=?",
        [userId, weekId, request.groupId!],
      );
      const entryNumber = Number(numberRows[0]?.next_number ?? 1);
      const maxEntriesPerMember = Number(settings[0]?.max_entries_per_member ?? 1);
      if (entryNumber > maxEntriesPerMember)
        throw new HttpError(409, `This group allows ${maxEntriesPerMember} ${maxEntriesPerMember === 1 ? 'entry' : 'entries'} per player each week`);
      const [result] = await connection.execute<ResultSetHeader>(
        "INSERT INTO entries (user_id,week_id,entry_number,tiebreaker_total,group_id) VALUES (?,?,?,?,?)",
        [userId, weekId, entryNumber, body.tiebreakerTotal, request.groupId!],
      );
      entry = {
        id: result.insertId,
        status: "draft",
        tiebreaker_total: body.tiebreakerTotal,
        entry_number: entryNumber,
      } as EntryRow;
    }
    if (!entry || entry.status !== "draft")
      throw new HttpError(409, "Pending or approved entries cannot be edited");
    await connection.execute("DELETE FROM picks WHERE entry_id = ?", [
      entry.id,
    ]);
    for (const pick of body.picks) {
      await connection.execute(
        "INSERT INTO picks (entry_id, game_id, selected_team_id) VALUES (?, ?, ?)",
        [entry.id, pick.gameId, pick.teamId],
      );
    }
    await connection.commit();
    response.json({
      id: entry.id,
      entryId: entry.id,
      entryNumber: entry.entry_number,
      status: "draft",
    });
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
});

entriesRouter.post(
  "/entries/:entryId/submit-review",
  async (request, response) => {
    const userId = request.userId!;
    const entryId = z.coerce
      .number()
      .int()
      .positive()
      .parse(request.params.entryId);
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [settings] = await connection.query<RowDataPacket[]>('SELECT require_pick_approval,review_submission_message FROM pool_groups WHERE id=? FOR UPDATE',[request.groupId!]);
      const [entries] = await connection.query<
        (EntryRow & { week_name: string })[]
      >(
        `SELECT e.id, e.week_id, e.status, e.tiebreaker_total, w.name AS week_name FROM entries e
       JOIN weeks w ON w.id=e.week_id WHERE e.id=? AND e.user_id=? AND e.group_id=? AND w.status='open'
       AND w.picks_lock_at>UTC_TIMESTAMP(3) FOR UPDATE`,
        [entryId, userId, request.groupId!],
      );
      const entry = entries[0];
      if (!entry || !["draft", "rejected"].includes(entry.status))
        throw new HttpError(409, "This entry cannot be submitted for review");
      await requirePreviousWeeksFinal(connection,Number(entry.week_id));
      const [counts] = await connection.query<
        (RowDataPacket & { picks_count: number; games_count: number })[]
      >(
        `SELECT (SELECT COUNT(*) FROM picks WHERE entry_id=?) AS picks_count,
       (SELECT COUNT(*) FROM games g JOIN entries e ON e.week_id=g.week_id WHERE e.id=?) AS games_count`,
        [entryId, entryId],
      );
      if (
        !counts[0] ||
        Number(counts[0].picks_count) !== Number(counts[0].games_count) ||
        entry.tiebreaker_total == null
      ) {
        throw new HttpError(
          400,
          "Complete every pick and the tiebreaker before submitting",
        );
      }
      const needsReview = Boolean(settings[0]?.require_pick_approval) && request.groupRole !== 'commissioner';
      const status = needsReview ? 'pending_review' : 'submitted';
      await connection.execute(
        "UPDATE entries SET status=?, submitted_at=UTC_TIMESTAMP(3) WHERE id=?",
        [status, entryId],
      );
      const [admins] = await connection.query<
        (RowDataPacket & { id: number })[]
      >("SELECT user_id AS id FROM group_members WHERE group_id=? AND role='commissioner'", [request.groupId!]);
      for (const admin of needsReview ? admins : []) {
        await connection.execute(
          `INSERT INTO notifications (user_id,entry_id,type,message) VALUES (?,?,'pick_review_requested',?)
         ON DUPLICATE KEY UPDATE message=VALUES(message),read_at=NULL,created_at=CURRENT_TIMESTAMP(3)`,
          [
            admin.id,
            entryId,
            `A player submitted picks for ${entry.week_name}`,
          ],
        );
      }
      if (needsReview) await queuePickReviewRequested(connection,entryId);
      else await queuePickDecision(connection,entryId,'approved');
      await connection.commit();
      response.json({ entryId, status, reviewSubmissionMessage: needsReview ? settings[0]?.review_submission_message ?? null : null });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  },
);
