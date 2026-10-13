import type { PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { config } from '../config.js';
import { findWinners, type ScoredEntry } from '../services/scoring.js';
import { pool } from './pool.js';

const CURRENT_LABEL = 'Apple Review Current';
const HISTORY_LABEL = 'Apple Review History';
const DEMO_PLAYERS = [
  { name: 'Alex Carter', email: 'apple-review.alex@example.invalid', tiebreaker: 41 },
  { name: 'Jordan Blake', email: 'apple-review.jordan@example.invalid', tiebreaker: 44 },
  { name: 'Taylor Morgan', email: 'apple-review.taylor@example.invalid', tiebreaker: 47 },
  { name: 'Casey Brooks', email: 'apple-review.casey@example.invalid', tiebreaker: 50 },
  { name: 'Riley Parker', email: 'apple-review.riley@example.invalid', tiebreaker: 53 },
  { name: 'Cameron Reed', email: 'apple-review.cameron@example.invalid', tiebreaker: 56 },
] as const;

type UserRow = RowDataPacket & { id: number; email: string; display_name: string; password_hash: string | null };
type GroupRow = RowDataPacket & { id: number; name: string; commissioner_role: string; member_role: string };
type WeekRow = RowDataPacket & { id: number; name: string };
type GameRow = RowDataPacket & {
  id: number;
  away_team_id: number;
  home_team_id: number;
  away_score: number | null;
  home_score: number | null;
  is_monday_tiebreaker: number;
};
type EntryRow = RowDataPacket & { id: number; entry_number: number };
type ScoreRow = RowDataPacket & { entry_id: number; tiebreaker_total: number; correct_picks: number };

async function ensureDemoPlayers(db: PoolConnection, groupId: number): Promise<Array<{ id: number; tiebreaker: number }>> {
  const players: Array<{ id: number; tiebreaker: number }> = [];
  for (const player of DEMO_PLAYERS) {
    await db.execute(
      `INSERT INTO users (email,display_name,password_hash,role,reminder_emails,result_emails)
       VALUES (?,?,NULL,'player',FALSE,FALSE)
       ON DUPLICATE KEY UPDATE display_name=VALUES(display_name),password_hash=NULL,role='player',
       reminder_emails=FALSE,result_emails=FALSE`,
      [player.email, player.name],
    );
    const [users] = await db.query<(RowDataPacket & { id: number })[]>('SELECT id FROM users WHERE email=? FOR UPDATE', [player.email]);
    const userId = Number(users[0]!.id);
    await db.execute(
      `INSERT INTO group_members (group_id,user_id,role) VALUES (?,?,'member')
       ON DUPLICATE KEY UPDATE role='member'`,
      [groupId, userId],
    );
    players.push({ id: userId, tiebreaker: player.tiebreaker });
  }
  return players;
}

function requiredEmail(value: string | undefined, name: string): string {
  if (!value) throw new Error(`${name} must be set before running this command`);
  return value.trim().toLowerCase();
}

async function ensureEntry(
  db: PoolConnection,
  input: { userId: number; weekId: number; groupId: number; label: string; status: 'pending_review' | 'submitted'; tiebreaker: number },
): Promise<number> {
  const [matches] = await db.query<EntryRow[]>(
    'SELECT id,entry_number FROM entries WHERE user_id=? AND week_id=? AND group_id=? AND label=? FOR UPDATE',
    [input.userId, input.weekId, input.groupId, input.label],
  );
  if (matches.length > 1) throw new Error(`More than one entry is labeled "${input.label}"; remove the duplicate before rerunning`);

  let entryId = matches[0]?.id;
  if (!entryId) {
    const [numbers] = await db.query<EntryRow[]>(
      'SELECT entry_number FROM entries WHERE user_id=? AND week_id=? AND group_id=? ORDER BY entry_number FOR UPDATE',
      [input.userId, input.weekId, input.groupId],
    );
    const used = new Set(numbers.map(row => Number(row.entry_number)));
    const entryNumber = Array.from({ length: 10 }, (_, index) => index + 1).find(number => !used.has(number));
    if (!entryNumber) throw new Error(`No entry slot is available for ${input.label}; the group limit is 10`);
    const [result] = await db.execute<ResultSetHeader>(
      `INSERT INTO entries (user_id,week_id,entry_number,label,tiebreaker_total,group_id,status,submitted_at)
       VALUES (?,?,?,?,?,?,?,UTC_TIMESTAMP(3))`,
      [input.userId, input.weekId, entryNumber, input.label, input.tiebreaker, input.groupId, input.status],
    );
    entryId = result.insertId;
  } else {
    await db.execute(
      `UPDATE entries SET status=?,tiebreaker_total=?,submitted_at=UTC_TIMESTAMP(3),correct_picks=NULL,
       tiebreaker_difference=NULL WHERE id=?`,
      [input.status, input.tiebreaker, entryId],
    );
  }
  return entryId;
}

async function replacePicks(db: PoolConnection, entryId: number, games: GameRow[], chooseHome: (index: number) => boolean) {
  await db.execute('DELETE FROM picks WHERE entry_id=?', [entryId]);
  for (const [index, game] of games.entries()) {
    const selectedTeamId = chooseHome(index) ? game.home_team_id : game.away_team_id;
    await db.execute('INSERT INTO picks (entry_id,game_id,selected_team_id) VALUES (?,?,?)', [entryId, game.id, selectedTeamId]);
  }
}

async function scoreReviewGroup(db: PoolConnection, weekId: number, groupId: number): Promise<number> {
  const [totalRows] = await db.query<(RowDataPacket & { actual_total: number | null })[]>(
    `SELECT home_score+away_score AS actual_total FROM games
     WHERE week_id=? AND is_monday_tiebreaker=TRUE AND status='final' LIMIT 1`,
    [weekId],
  );
  const actualTotal = totalRows[0]?.actual_total;
  if (actualTotal == null) throw new Error('The completed review week does not have a final Monday tiebreaker game');

  const [scores] = await db.query<ScoreRow[]>(
    `SELECT e.id AS entry_id,e.tiebreaker_total,
      SUM(CASE WHEN (g.home_score>g.away_score AND p.selected_team_id=g.home_team_id)
        OR (g.away_score>g.home_score AND p.selected_team_id=g.away_team_id) THEN 1 ELSE 0 END) AS correct_picks
     FROM entries e JOIN picks p ON p.entry_id=e.id JOIN games g ON g.id=p.game_id
     WHERE e.week_id=? AND e.group_id=? AND e.status='submitted'
     GROUP BY e.id,e.tiebreaker_total`,
    [weekId, groupId],
  );
  const scored: ScoredEntry[] = scores.map(row => ({
    entryId: Number(row.entry_id),
    correctPicks: Number(row.correct_picks),
    tiebreakerDifference: Math.abs(Number(row.tiebreaker_total) - Number(actualTotal)),
  }));
  for (const entry of scored) {
    await db.execute('UPDATE entries SET correct_picks=?,tiebreaker_difference=? WHERE id=?', [entry.correctPicks, entry.tiebreakerDifference, entry.entryId]);
  }
  const winners = findWinners(scored);
  await db.execute(
    'DELETE ww FROM weekly_winners ww JOIN entries e ON e.id=ww.entry_id WHERE ww.week_id=? AND e.group_id=?',
    [weekId, groupId],
  );
  await db.execute('DELETE FROM weekly_results WHERE week_id=? AND group_id=?', [weekId, groupId]);
  for (const winner of winners) {
    await db.execute('INSERT INTO weekly_winners (week_id,entry_id,prize_cents) VALUES (?,?,0)', [weekId, winner.entryId]);
  }
  const best = winners[0];
  await db.execute(
    `INSERT INTO weekly_results (week_id,group_id,winning_correct_picks,winning_tiebreaker_difference,calculated_at)
     VALUES (?,?,?,?,UTC_TIMESTAMP(3))`,
    [weekId, groupId, best?.correctPicks ?? null, best?.tiebreakerDifference ?? null],
  );
  return winners.length;
}

async function setup() {
  const commissionerEmail = requiredEmail(config.APP_REVIEW_COMMISSIONER_EMAIL, 'APP_REVIEW_COMMISSIONER_EMAIL');
  const memberEmail = requiredEmail(config.APP_REVIEW_MEMBER_EMAIL, 'APP_REVIEW_MEMBER_EMAIL');
  if (commissionerEmail === memberEmail) throw new Error('The App Review commissioner and member must be different accounts');

  const db = await pool.getConnection();
  try {
    await db.beginTransaction();
    const [users] = await db.query<UserRow[]>(
      'SELECT id,email,display_name,password_hash FROM users WHERE LOWER(email) IN (?,?) FOR UPDATE',
      [commissionerEmail, memberEmail],
    );
    const commissioner = users.find(user => user.email.toLowerCase() === commissionerEmail);
    const member = users.find(user => user.email.toLowerCase() === memberEmail);
    if (!commissioner || !member) throw new Error('Both App Review accounts must already exist');
    if (!commissioner.password_hash || !member.password_hash) throw new Error('Both App Review accounts must have working passwords');

    const [groups] = await db.query<GroupRow[]>(
      `SELECT g.id,g.name,cm.role AS commissioner_role,mm.role AS member_role
       FROM pool_groups g
       JOIN group_members cm ON cm.group_id=g.id AND cm.user_id=?
       JOIN group_members mm ON mm.group_id=g.id AND mm.user_id=?
       FOR UPDATE`,
      [commissioner.id, member.id],
    );
    if (groups.length !== 1) throw new Error(`The App Review accounts must share exactly one group; found ${groups.length}`);
    const group = groups[0]!;
    if (group.commissioner_role !== 'commissioner' || group.member_role !== 'member') {
      throw new Error('The configured commissioner must be the group commissioner and the configured member must be a regular member');
    }
    await db.execute(
      `UPDATE pool_groups SET require_pick_approval=TRUE,allow_multiple_entries=TRUE,
       max_entries_per_member=GREATEST(max_entries_per_member,2) WHERE id=?`,
      [group.id],
    );
    const demoPlayers = await ensureDemoPlayers(db, group.id);

    const [openWeeks] = await db.query<WeekRow[]>(
      `SELECT w.id,w.name FROM weeks w
       WHERE w.status='open' AND w.picks_lock_at>UTC_TIMESTAMP(3)
       AND EXISTS (SELECT 1 FROM games g WHERE g.week_id=w.id)
       AND NOT EXISTS (SELECT 1 FROM weeks previous WHERE previous.season_id=w.season_id
         AND previous.week_number<w.week_number AND previous.status<>'final')
       ORDER BY w.picks_lock_at LIMIT 1 FOR UPDATE`,
    );
    const openWeek = openWeeks[0];
    if (!openWeek) throw new Error('No accessible open week with games was found. Import/open the current schedule week, then rerun this command');
    const [openGames] = await db.query<GameRow[]>(
      `SELECT id,away_team_id,home_team_id,away_score,home_score,is_monday_tiebreaker
       FROM games WHERE week_id=? ORDER BY kickoff_at,id FOR UPDATE`,
      [openWeek.id],
    );
    const commissionerCurrentId = await ensureEntry(db, {
      userId: commissioner.id, weekId: openWeek.id, groupId: group.id, label: CURRENT_LABEL, status: 'submitted', tiebreaker: 44,
    });
    const memberCurrentId = await ensureEntry(db, {
      userId: member.id, weekId: openWeek.id, groupId: group.id, label: CURRENT_LABEL, status: 'pending_review', tiebreaker: 47,
    });
    await replacePicks(db, commissionerCurrentId, openGames, index => index % 2 === 0);
    await replacePicks(db, memberCurrentId, openGames, index => index % 2 !== 0);
    for (const [playerIndex, player] of demoPlayers.entries()) {
      const entryId = await ensureEntry(db, {
        userId: player.id,
        weekId: openWeek.id,
        groupId: group.id,
        label: CURRENT_LABEL,
        status: 'submitted',
        tiebreaker: player.tiebreaker,
      });
      await replacePicks(db, entryId, openGames, gameIndex => (gameIndex + playerIndex) % 3 !== 0);
    }
    await db.execute(
      `INSERT INTO notifications (user_id,entry_id,type,message)
       VALUES (?,?,'pick_review_requested',?)
       ON DUPLICATE KEY UPDATE message=VALUES(message),read_at=NULL,created_at=UTC_TIMESTAMP(3)`,
      [commissioner.id, memberCurrentId, `${member.display_name} submitted ${CURRENT_LABEL} for ${openWeek.name} for review.`],
    );

    const [finalWeeks] = await db.query<WeekRow[]>(
      `SELECT w.id,w.name FROM weeks w
       WHERE w.status='final'
       AND EXISTS (SELECT 1 FROM games g WHERE g.week_id=w.id)
       AND NOT EXISTS (SELECT 1 FROM games g WHERE g.week_id=w.id AND g.status<>'final')
       AND EXISTS (SELECT 1 FROM games g WHERE g.week_id=w.id AND g.is_monday_tiebreaker=TRUE
         AND g.status='final' AND g.home_score IS NOT NULL AND g.away_score IS NOT NULL)
       ORDER BY w.picks_lock_at DESC LIMIT 1 FOR UPDATE`,
    );
    const finalWeek = finalWeeks[0];
    let winnerCount = 0;
    if (finalWeek) {
      const [finalGames] = await db.query<GameRow[]>(
        `SELECT id,away_team_id,home_team_id,away_score,home_score,is_monday_tiebreaker
         FROM games WHERE week_id=? ORDER BY kickoff_at,id FOR UPDATE`,
        [finalWeek.id],
      );
      const tiebreakerGame = finalGames.find(game => Boolean(game.is_monday_tiebreaker));
      const actualTotal = Number(tiebreakerGame!.away_score) + Number(tiebreakerGame!.home_score);
      const commissionerHistoryId = await ensureEntry(db, {
        userId: commissioner.id, weekId: finalWeek.id, groupId: group.id, label: HISTORY_LABEL, status: 'submitted', tiebreaker: actualTotal,
      });
      const memberHistoryId = await ensureEntry(db, {
        userId: member.id, weekId: finalWeek.id, groupId: group.id, label: HISTORY_LABEL, status: 'submitted', tiebreaker: Math.min(200, actualTotal + 7),
      });
      await replacePicks(db, commissionerHistoryId, finalGames, index => {
        const game = finalGames[index]!;
        return Number(game.home_score) >= Number(game.away_score);
      });
      await replacePicks(db, memberHistoryId, finalGames, index => {
        const game = finalGames[index]!;
        return Number(game.home_score) < Number(game.away_score);
      });
      for (const [playerIndex, player] of demoPlayers.entries()) {
        const historyEntryId = await ensureEntry(db, {
          userId: player.id,
          weekId: finalWeek.id,
          groupId: group.id,
          label: HISTORY_LABEL,
          status: 'submitted',
          tiebreaker: Math.max(0, Math.min(200, actualTotal + playerIndex - 2)),
        });
        await replacePicks(db, historyEntryId, finalGames, gameIndex => (gameIndex + playerIndex) % 4 !== 0);
      }
      winnerCount = await scoreReviewGroup(db, finalWeek.id, group.id);
    }

    await db.commit();
    console.log(JSON.stringify({
      message: 'App Review sample data is ready',
      group: { id: group.id, name: group.name },
      demoPlayers: demoPlayers.length,
      currentWeek: openWeek.name,
      pendingReviewEntryId: memberCurrentId,
      completedWeek: finalWeek?.name ?? null,
      completedWeekWinners: winnerCount,
      note: finalWeek ? 'Current and completed review scenarios were created.' : 'No completed week was available, so only the current review scenario was created.',
    }, null, 2));
  } catch (error) {
    await db.rollback();
    throw error;
  } finally {
    db.release();
  }
}

setup()
  .catch(error => {
    console.error(`App Review setup failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
