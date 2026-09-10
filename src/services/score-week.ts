import type { RowDataPacket } from 'mysql2';
import { pool } from '../db/pool.js';
import { HttpError } from '../lib/http-error.js';
import { findWinners, type ScoredEntry } from './scoring.js';
import { queueEmail } from './email-outbox.js';
import { config } from '../config.js';
import { createHash } from 'node:crypto';

type WeekRow = RowDataPacket & { id: number };
type EntryScoreRow = RowDataPacket & { entry_id: number; group_id: number; tiebreaker_total: number; correct_picks: number };
type TotalRow = RowDataPacket & { actual_total: number | null };

export async function updateWeekLeaderboard(weekId: number): Promise<void> {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [weeks] = await connection.query<WeekRow[]>('SELECT id FROM weeks WHERE id = ? FOR UPDATE', [weekId]);
    if (!weeks[0]) throw new HttpError(404, 'Week not found');
    const [totals] = await connection.query<TotalRow[]>(
      'SELECT home_score + away_score AS actual_total FROM games WHERE week_id = ? AND is_monday_tiebreaker = TRUE AND status = \'final\'', [weekId]
    );
    const actualTotal = totals[0]?.actual_total;
    const [scores] = await connection.query<EntryScoreRow[]>(
      `SELECT e.id AS entry_id, e.group_id, e.tiebreaker_total,
        SUM(CASE WHEN g.status = 'final' AND ((g.home_score > g.away_score AND p.selected_team_id = g.home_team_id)
          OR (g.away_score > g.home_score AND p.selected_team_id = g.away_team_id)) THEN 1 ELSE 0 END) AS correct_picks
       FROM entries e JOIN picks p ON p.entry_id = e.id JOIN games g ON g.id = p.game_id
       WHERE e.week_id = ? AND e.status = 'submitted' GROUP BY e.id, e.group_id, e.tiebreaker_total`, [weekId]
    );
    for (const row of scores) {
      await connection.execute(
        'UPDATE entries SET correct_picks = ?, tiebreaker_difference = ? WHERE id = ?',
        [Number(row.correct_picks), actualTotal == null ? null : Math.abs(row.tiebreaker_total - actualTotal), row.entry_id],
      );
    }
    await connection.commit();
  } catch (error) { await connection.rollback(); throw error; }
  finally { connection.release(); }
}

export async function scoreWeek(weekId: number): Promise<{ winners: number }> {
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
      `SELECT e.id AS entry_id, e.group_id, e.tiebreaker_total,
        SUM(CASE WHEN (g.home_score > g.away_score AND p.selected_team_id = g.home_team_id)
          OR (g.away_score > g.home_score AND p.selected_team_id = g.away_team_id) THEN 1 ELSE 0 END) AS correct_picks
       FROM entries e JOIN picks p ON p.entry_id = e.id JOIN games g ON g.id = p.game_id
       WHERE e.week_id = ? AND e.status = 'submitted' GROUP BY e.id, e.group_id, e.tiebreaker_total`, [weekId]
    );
    const scored: ScoredEntry[] = scores.map((row) => ({
      entryId: row.entry_id, correctPicks: Number(row.correct_picks), tiebreakerDifference: Math.abs(row.tiebreaker_total - actualTotal)
    }));
    for (const entry of scored) {
      await connection.execute('UPDATE entries SET correct_picks = ?, tiebreaker_difference = ? WHERE id = ?', [entry.correctPicks, entry.tiebreakerDifference, entry.entryId]);
    }
    await connection.execute('DELETE FROM weekly_winners WHERE week_id = ?', [weekId]);
    await connection.execute('DELETE FROM weekly_results WHERE week_id = ?', [weekId]);
    let winnerCount = 0;
    for (const groupId of new Set(scores.map(row => row.group_id))) {
      const ids = new Set(scores.filter(row => row.group_id === groupId).map(row => row.entry_id));
      const winners = findWinners(scored.filter(entry => ids.has(entry.entryId)));
      winnerCount += winners.length;
      for (const winner of winners) {
        await connection.execute('INSERT INTO weekly_winners (week_id, entry_id, prize_cents) VALUES (?, ?, 0)', [weekId, winner.entryId]);
      }
      const best = winners[0];
      await connection.execute(
        'INSERT INTO weekly_results (week_id,group_id,winning_correct_picks,winning_tiebreaker_difference,calculated_at) VALUES (?,?,?,?,UTC_TIMESTAMP(3))',
        [weekId,groupId,best?.correctPicks ?? null,best?.tiebreakerDifference ?? null],
      );
    }
    await connection.execute("UPDATE weeks SET status = 'final' WHERE id = ?", [weekId]);
    const [recipients]=await connection.query<RowDataPacket[]>(`SELECT u.id,u.email,g.id AS groupId,g.name,w.name AS weekName
      FROM weekly_results r JOIN pool_groups g ON g.id=r.group_id JOIN group_members m ON m.group_id=g.id
      JOIN users u ON u.id=m.user_id JOIN weeks w ON w.id=r.week_id WHERE r.week_id=?`,[weekId]);
    for(const groupId of new Set(scores.map(row=>row.group_id))) {
      const [leaders]=await connection.query<RowDataPacket[]>(`SELECT u.display_name,e.entry_number,e.correct_picks,e.tiebreaker_difference
        FROM weekly_winners win JOIN entries e ON e.id=win.entry_id JOIN users u ON u.id=e.user_id
        WHERE win.week_id=? AND e.group_id=? ORDER BY e.id`,[weekId,groupId]);
      const groupScores=scores.filter(row=>row.group_id===groupId).sort((a,b)=>a.entry_id-b.entry_id);
      const revision=createHash('sha256').update(JSON.stringify([actualTotal,groupScores])).digest('hex').slice(0,24);
      for(const row of recipients.filter(row=>row.groupId===groupId)) await queueEmail(connection,{
        key:`results:${groupId}:${weekId}:${row.id}:${revision}`,kind:'results',to:row.email,userId:row.id,groupId,weekId,
        subject:"Huddle Pick'em: weekly results are ready",
        body:`${row.weekName} results for ${row.name} are ready.\n\nWinner${leaders.length===1?'':'s'}:\n${leaders.map(winner=>`${winner.display_name} (entry #${winner.entry_number}): ${winner.correct_picks} correct picks, tiebreaker difference ${winner.tiebreaker_difference}`).join('\n')}\n\nSee your results in Pick history: ${config.APP_URL}`});
    }
    await connection.commit();
    return { winners: winnerCount };
  } catch (error) { await connection.rollback(); throw error; }
  finally { connection.release(); }
}
