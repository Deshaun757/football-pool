import type { RowDataPacket } from 'mysql2';
import { pool } from './pool.js';
import { scoreWeek } from '../services/score-week.js';

type IdRow = RowDataPacket & { id: number; abbreviation?: string; email?: string };

const players = [
  { name: 'Alex Rivers', email: 'demo.alex@example.invalid', tiebreaker: 44 },
  { name: 'Jordan Lee', email: 'demo.jordan@example.invalid', tiebreaker: 48 },
  { name: 'Taylor Brooks', email: 'demo.taylor@example.invalid', tiebreaker: 51 },
  { name: 'Morgan Reed', email: 'demo.morgan@example.invalid', tiebreaker: 42 },
  { name: 'Casey Parker', email: 'demo.casey@example.invalid', tiebreaker: 46 },
  { name: 'Riley Quinn', email: 'demo.riley@example.invalid', tiebreaker: 39 }
];

const games = [
  { externalId: 'DEMO_2025_18_BUF_NE', away: 'BUF', home: 'NE', kickoff: '2026-01-04 18:00:00', awayScore: 27, homeScore: 20 },
  { externalId: 'DEMO_2025_18_PHI_DAL', away: 'PHI', home: 'DAL', kickoff: '2026-01-04 21:25:00', awayScore: 24, homeScore: 31 },
  { externalId: 'DEMO_2025_18_BAL_PIT', away: 'BAL', home: 'PIT', kickoff: '2026-01-04 21:25:00', awayScore: 17, homeScore: 21 },
  { externalId: 'DEMO_2025_18_KC_DEN', away: 'KC', home: 'DEN', kickoff: '2026-01-05 01:20:00', awayScore: 30, homeScore: 23 },
  { externalId: 'DEMO_2025_18_GB_CHI', away: 'GB', home: 'CHI', kickoff: '2026-01-05 18:00:00', awayScore: 20, homeScore: 16 },
  { externalId: 'DEMO_2025_18_SF_LA', away: 'SF', home: 'LA', kickoff: '2026-01-06 01:15:00', awayScore: 21, homeScore: 24, tiebreaker: true }
];

const selections = [
  ['BUF', 'DAL', 'PIT', 'KC', 'GB', 'LA'],
  ['BUF', 'PHI', 'PIT', 'KC', 'GB', 'LA'],
  ['NE', 'DAL', 'BAL', 'KC', 'GB', 'SF'],
  ['BUF', 'DAL', 'PIT', 'DEN', 'CHI', 'LA'],
  ['BUF', 'DAL', 'BAL', 'KC', 'GB', 'LA'],
  ['NE', 'PHI', 'PIT', 'DEN', 'GB', 'SF']
];

const connection = await pool.getConnection();
let weekId: number;
try {
  await connection.beginTransaction();
  const [teamRows] = await connection.query<IdRow[]>('SELECT id, abbreviation FROM teams');
  const teamIds = new Map(teamRows.map(row => [row.abbreviation!, row.id]));
  for (const game of games) {
    if (!teamIds.has(game.away) || !teamIds.has(game.home)) throw new Error('Import the NFL schedule before seeding demo data');
  }

  await connection.execute(
    `INSERT INTO seasons (year, name) VALUES (2025, '2025 Demo Season')
     ON DUPLICATE KEY UPDATE name=VALUES(name)`
  );
  const [seasons] = await connection.query<IdRow[]>('SELECT id FROM seasons WHERE year=2025');
  const seasonId = seasons[0]!.id;
  await connection.execute(
    `INSERT INTO weeks (season_id, week_number, name, picks_lock_at, status)
     VALUES (?, 18, 'Demo Week — Previous Picks', '2026-01-04 17:00:00', 'locked')
     ON DUPLICATE KEY UPDATE name=VALUES(name), picks_lock_at=VALUES(picks_lock_at), status='locked'`, [seasonId]
  );
  const [weeks] = await connection.query<IdRow[]>('SELECT id FROM weeks WHERE season_id=? AND week_number=18', [seasonId]);
  weekId = weeks[0]!.id;

  for (const game of games) {
    await connection.execute(
      `INSERT INTO games (external_id, week_id, away_team_id, home_team_id, kickoff_at, is_monday_tiebreaker, away_score, home_score, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'final') ON DUPLICATE KEY UPDATE week_id=VALUES(week_id), away_team_id=VALUES(away_team_id),
       home_team_id=VALUES(home_team_id), kickoff_at=VALUES(kickoff_at), is_monday_tiebreaker=VALUES(is_monday_tiebreaker),
       away_score=VALUES(away_score), home_score=VALUES(home_score), status='final'`,
      [game.externalId, weekId, teamIds.get(game.away)!, teamIds.get(game.home)!, game.kickoff, game.tiebreaker ?? false, game.awayScore, game.homeScore]
    );
  }
  const [gameRows] = await connection.query<(IdRow & { external_id: string })[]>('SELECT id, external_id FROM games WHERE week_id=? ORDER BY kickoff_at', [weekId]);
  const gameIds = new Map(gameRows.map(row => [row.external_id, row.id]));

  for (let playerIndex = 0; playerIndex < players.length; playerIndex++) {
    const player = players[playerIndex]!;
    await connection.execute(
      `INSERT INTO users (email, display_name, password_hash, role) VALUES (?, ?, NULL, 'player')
       ON DUPLICATE KEY UPDATE display_name=VALUES(display_name)`, [player.email, player.name]
    );
    const [users] = await connection.query<IdRow[]>('SELECT id FROM users WHERE email=?', [player.email]);
    const userId = users[0]!.id;
    await connection.execute('INSERT IGNORE INTO group_members (group_id,user_id) VALUES (1,?)',[userId]);
    await connection.execute(
      `INSERT INTO entries (user_id, week_id, status, tiebreaker_total, submitted_at)
       VALUES (?, ?, 'submitted', ?, '2026-01-04 16:30:00') ON DUPLICATE KEY UPDATE status='submitted',
       tiebreaker_total=VALUES(tiebreaker_total), submitted_at=VALUES(submitted_at)`, [userId, weekId, player.tiebreaker]
    );
    const [entries] = await connection.query<IdRow[]>('SELECT id FROM entries WHERE user_id=? AND week_id=? AND group_id=1', [userId, weekId]);
    const entryId = entries[0]!.id;
    await connection.execute('DELETE FROM picks WHERE entry_id=?', [entryId]);
    for (let gameIndex = 0; gameIndex < games.length; gameIndex++) {
      const game = games[gameIndex]!;
      await connection.execute('INSERT INTO picks (entry_id, game_id, selected_team_id) VALUES (?, ?, ?)', [entryId, gameIds.get(game.externalId)!, teamIds.get(selections[playerIndex]![gameIndex]!)!]);
    }
  }
  await connection.commit();
} catch (error) {
  await connection.rollback();
  throw error;
} finally {
  connection.release();
}

const result = await scoreWeek(weekId!);
console.log(`Demo data ready: ${players.length} players, ${games.length} games, ${result.winners} winner(s)`);
await pool.end();
