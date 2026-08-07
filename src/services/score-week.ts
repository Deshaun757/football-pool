import type { RowDataPacket } from 'mysql2';
import { pool } from '../db/pool.js';
import { HttpError } from '../lib/http-error.js';
import { findWinners, splitPrize, type ScoredEntry } from './scoring.js';

type WeekRow = RowDataPacket & { id: number };
type EntryScoreRow = RowDataPacket & { entry_id: number; tiebreaker_total: number; correct_picks: number };
type TotalRow = RowDataPacket & { actual_total: number | null };
type PoolRow = RowDataPacket & { prize_pool: number };

export async function scoreWeek(weekId: number): Promise<{ winners: number; prizePoolCents: number }> {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [weeks] = await connection.query<WeekRow[]>('SELECT id FROM weeks WHERE id = ? FOR UPDATE', [weekId]);
    if (!weeks[0]) throw new HttpError(404, 'Week not found');
    const [unfinished] = await connection.query<RowDataPacket[]>('SELECT id FROM games WHERE week_id = ? AND status <> \'final\' LIMIT 1', [weekId]);
    if (unfinished.length) throw new HttpError(409, 'Every game must be final before scoring');
    const [totals] = await connection.query<TotalRow[]>(
      'SELECT home_score + away_score AS actual_total FROM games WHERE week_id = ? AND is_monday_tiebreaker = TRUE AND status = \'final\'', [weekId]
    );
    const actualTotal = totals[0]?.actual_total;
    if (actualTotal == null) throw new HttpError(409, 'A final Monday tiebreaker game is required');

    const [scores] = await connection.query<EntryScoreRow[]>(
      `SELECT e.id AS entry_id, e.tiebreaker_total,
        SUM(CASE WHEN (g.home_score > g.away_score AND p.selected_team_id = g.home_team_id)
          OR (g.away_score > g.home_score AND p.selected_team_id = g.away_team_id) THEN 1 ELSE 0 END) AS correct_picks
       FROM entries e JOIN picks p ON p.entry_id = e.id JOIN games g ON g.id = p.game_id
       WHERE e.week_id = ? AND e.status = 'submitted' GROUP BY e.id, e.tiebreaker_total`, [weekId]
    );
    const scored: ScoredEntry[] = scores.map((row) => ({
      entryId: row.entry_id, correctPicks: Number(row.correct_picks), tiebreakerDifference: Math.abs(row.tiebreaker_total - actualTotal)
    }));
    for (const entry of scored) {
      await connection.execute('UPDATE entries SET correct_picks = ?, tiebreaker_difference = ? WHERE id = ?', [entry.correctPicks, entry.tiebreakerDifference, entry.entryId]);
    }
    const winners = findWinners(scored);
    const [poolRows] = await connection.query<PoolRow[]>(
      `SELECT COALESCE(SUM(COALESCE(p.net_amount_cents, p.gross_amount_cents)), 0) AS prize_pool
       FROM payments p JOIN entries e ON e.id = p.entry_id WHERE e.week_id = ? AND p.status = 'paid'`, [weekId]
    );
    const prizePool = Number(poolRows[0]?.prize_pool ?? 0);
    const prizes = splitPrize(prizePool, winners.map((winner) => winner.entryId));
    await connection.execute('DELETE FROM weekly_winners WHERE week_id = ?', [weekId]);
    for (const winner of winners) {
      await connection.execute('INSERT INTO weekly_winners (week_id, entry_id, prize_cents) VALUES (?, ?, ?)', [weekId, winner.entryId, prizes.get(winner.entryId)!]);
    }
    const best = winners[0];
    await connection.execute(
      `INSERT INTO weekly_results (week_id, prize_pool_cents, winning_correct_picks, winning_tiebreaker_difference, calculated_at)
       VALUES (?, ?, ?, ?, UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE prize_pool_cents=VALUES(prize_pool_cents),
       winning_correct_picks=VALUES(winning_correct_picks), winning_tiebreaker_difference=VALUES(winning_tiebreaker_difference), calculated_at=VALUES(calculated_at)`,
      [weekId, prizePool, best?.correctPicks ?? null, best?.tiebreakerDifference ?? null]
    );
    await connection.execute("UPDATE weeks SET status = 'final' WHERE id = ?", [weekId]);
    await connection.commit();
    return { winners: winners.length, prizePoolCents: prizePool };
  } catch (error) { await connection.rollback(); throw error; }
  finally { connection.release(); }
}
