import { Router } from "express";
import type { RowDataPacket } from "mysql2";
import { z } from "zod";
import { pool } from "../db/pool.js";

export const weeksRouter = Router();


type BoardWeekRow = RowDataPacket & {
  id: number;
  name: string;
  weekNumber: number;
  picksLockAt: Date;
  status: string;
};
type BoardGameRow = RowDataPacket & {
  id: number;
  kickoffAt: Date;
  awayTeamId: number;
  awayAbbreviation: string;
  awayLogoUrl: string | null;
  homeTeamId: number;
  homeAbbreviation: string;
  homeLogoUrl: string | null;
  awayScore: number | null;
  homeScore: number | null;
  status: string;
  isTiebreaker: number;
};
type BoardEntryRow = RowDataPacket & {
  id: number;
  displayName: string;
  tiebreakerTotal: number;
};
type BoardPickRow = RowDataPacket & {
  entryId: number;
  gameId: number;
  selectedTeamId: number;
  selectedAbbreviation: string;
};
type PoolRow = RowDataPacket & { approvedEntries: number };

weeksRouter.get("/picks-board", async (request, response) => {
  const [lockedWeeks] = await pool.query<BoardWeekRow[]>(
    `SELECT id, name, week_number AS weekNumber, picks_lock_at AS picksLockAt, status
     FROM weeks WHERE status <> 'draft' AND picks_lock_at <= UTC_TIMESTAMP(3)
     ORDER BY picks_lock_at DESC LIMIT 1`,
  );
  const [activeWeeks] = await pool.query<BoardWeekRow[]>(
    `SELECT id, name, week_number AS weekNumber, picks_lock_at AS picksLockAt, status
     FROM weeks WHERE status = 'open' AND picks_lock_at > UTC_TIMESTAMP(3)
     ORDER BY picks_lock_at ASC LIMIT 1`,
  );
  const displayWeek = lockedWeeks[0] ?? null;
  const poolWeek = activeWeeks[0] ?? displayWeek;
  let poolSummary = { approvedEntries: 0 };
  if (poolWeek) {
    const [rows] = await pool.query<PoolRow[]>(
      "SELECT COUNT(*) AS approvedEntries FROM entries WHERE week_id=? AND group_id=? AND status='submitted'",
      [poolWeek.id, request.groupId],
    );
    poolSummary = { approvedEntries: Number(rows[0]?.approvedEntries ?? 0) };
  }
  if (!displayWeek) {
    response.json({
      displayWeek: null,
      poolWeek,
      pool: poolSummary,

      games: [],
      entries: [],
    });
    return;
  }
  const [games] = await pool.query<BoardGameRow[]>(
    `SELECT g.id, g.kickoff_at AS kickoffAt, g.away_team_id AS awayTeamId, at.abbreviation AS awayAbbreviation,
      at.logo_url AS awayLogoUrl, g.home_team_id AS homeTeamId, ht.abbreviation AS homeAbbreviation,
      ht.logo_url AS homeLogoUrl, g.away_score AS awayScore, g.home_score AS homeScore, g.status,
      g.is_monday_tiebreaker AS isTiebreaker
     FROM games g JOIN teams at ON at.id=g.away_team_id JOIN teams ht ON ht.id=g.home_team_id
     WHERE g.week_id=? ORDER BY g.kickoff_at ASC, g.id ASC`,
    [displayWeek.id],
  );
  const [entries] = await pool.query<BoardEntryRow[]>(
    `SELECT e.id, CONCAT(u.display_name,' · Entry ',e.entry_number) AS displayName, e.tiebreaker_total AS tiebreakerTotal
     FROM entries e JOIN users u ON u.id=e.user_id WHERE e.week_id=? AND e.group_id=? AND e.status='submitted'
     ORDER BY u.display_name`,
    [displayWeek.id, request.groupId],
  );
  const [picks] = await pool.query<BoardPickRow[]>(
    `SELECT p.entry_id AS entryId, p.game_id AS gameId, p.selected_team_id AS selectedTeamId,
      t.abbreviation AS selectedAbbreviation FROM picks p JOIN teams t ON t.id=p.selected_team_id
     JOIN entries e ON e.id=p.entry_id WHERE e.week_id=? AND e.group_id=? AND e.status='submitted'`,
    [displayWeek.id, request.groupId],
  );
  const picksByEntry = new Map<number, Map<number, BoardPickRow>>();
  for (const pick of picks) {
    if (!picksByEntry.has(pick.entryId))
      picksByEntry.set(pick.entryId, new Map());
    picksByEntry.get(pick.entryId)!.set(pick.gameId, pick);
  }
  response.json({
    displayWeek,
    poolWeek,
    pool: poolSummary,

    games,
    entries: entries.map((entry) => ({
      ...entry,
      picks: Object.fromEntries(picksByEntry.get(entry.id) ?? []),
    })),
  });
});

weeksRouter.get("/weeks", async (request, response) => {
  const [rows] = await pool.query(
    `SELECT w.id, w.name, w.week_number AS weekNumber, w.picks_lock_at AS picksLockAt, w.status,
      COUNT(e.id) AS entryCount,
      SUM(CASE WHEN e.status='pending_review' THEN 1 ELSE 0 END) AS pendingCount,
      SUM(CASE WHEN e.status='submitted' THEN 1 ELSE 0 END) AS approvedCount
     FROM weeks w LEFT JOIN entries e ON e.week_id = w.id AND e.user_id = ? AND e.group_id = ?
     WHERE w.status <> 'draft' GROUP BY w.id,w.name,w.week_number,w.picks_lock_at,w.status
     ORDER BY w.picks_lock_at DESC`,
    [request.userId, request.groupId],
  );
  response.json(rows);
});

weeksRouter.get("/my-entries", async (request, response) => {
  const [rows] = await pool.query(
    `SELECT e.id, e.week_id AS weekId, e.entry_number AS entryNumber, e.label, e.status,
      e.tiebreaker_total AS tiebreakerTotal, e.correct_picks AS correctPicks,
      e.tiebreaker_difference AS tiebreakerDifference, e.submitted_at AS submittedAt,
      w.name AS weekName, w.week_number AS weekNumber, w.picks_lock_at AS picksLockAt
     FROM entries e JOIN weeks w ON w.id=e.week_id WHERE e.user_id=? AND e.group_id=?
     ORDER BY w.picks_lock_at DESC,e.entry_number ASC`,
    [request.userId, request.groupId],
  );
  response.json(rows);
});

weeksRouter.get("/weeks/:weekId", async (request, response) => {
  const weekId = z.coerce
    .number()
    .int()
    .positive()
    .parse(request.params.weekId);
  const [weeks] = await pool.query<RowDataPacket[]>(
    "SELECT id, name, week_number AS weekNumber, picks_lock_at AS picksLockAt, status FROM weeks WHERE id = ?",
    [weekId],
  );
  const [entries] = await pool.query<RowDataPacket[]>(
    `SELECT id,status,entry_number AS entryNumber,label,tiebreaker_total AS tiebreakerTotal,
      submitted_at AS submittedAt FROM entries WHERE user_id=? AND week_id=? AND group_id=? ORDER BY entry_number ASC`,
    [request.userId, weekId, request.groupId],
  );
  const requestedEntry = request.query.entryId;
  let selectedEntry: RowDataPacket | null = null;
  if (requestedEntry !== "new") {
    selectedEntry = requestedEntry
      ? (entries.find(
          (entry) =>
            entry.id ===
            z.coerce.number().int().positive().parse(requestedEntry),
        ) ?? null)
      : (entries[0] ?? null);
  }
  const [games] = await pool.query(
    `SELECT g.id, g.kickoff_at AS kickoffAt, g.status, g.is_monday_tiebreaker AS isMondayTiebreaker,
      g.home_score AS homeScore, g.away_score AS awayScore,
      ht.id AS homeTeamId, ht.abbreviation AS homeAbbreviation, ht.city AS homeCity, ht.name AS homeName, ht.logo_url AS homeLogoUrl,
      at.id AS awayTeamId, at.abbreviation AS awayAbbreviation, at.city AS awayCity, at.name AS awayName, at.logo_url AS awayLogoUrl,
      p.selected_team_id AS selectedTeamId
     FROM games g JOIN teams ht ON ht.id=g.home_team_id JOIN teams at ON at.id=g.away_team_id
     LEFT JOIN picks p ON p.entry_id=? AND p.game_id=g.id
     WHERE g.week_id=? ORDER BY g.kickoff_at ASC, g.id ASC`,
    [selectedEntry?.id ?? 0, weekId],
  );
  response.json({
    week: weeks[0] ?? null,
    games,
    entries,
    entry: selectedEntry,
  });
});

weeksRouter.get("/weeks/:weekId/leaderboard", async (request, response) => {
  const weekId = z.coerce
    .number()
    .int()
    .positive()
    .parse(request.params.weekId);
  const [rows] = await pool.query(
    `SELECT CONCAT(u.display_name,' · Entry ',e.entry_number) AS displayName, e.correct_picks AS correctPicks,
      CASE WHEN w.picks_lock_at <= UTC_TIMESTAMP(3) THEN e.tiebreaker_total ELSE NULL END AS tiebreakerTotal,
      e.tiebreaker_difference AS tiebreakerDifference
     FROM entries e JOIN users u ON u.id=e.user_id JOIN weeks w ON w.id=e.week_id

     WHERE e.week_id=? AND e.group_id=? AND e.status='submitted'
     ORDER BY e.correct_picks DESC, e.tiebreaker_difference ASC, e.submitted_at ASC`,
    [weekId, request.groupId],
  );
  response.json(rows);
});
