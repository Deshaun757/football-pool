import { parse } from 'csv-parse/sync';
import { DateTime } from 'luxon';
import type { ResultSetHeader, RowDataPacket } from 'mysql2';
import { pool } from '../db/pool.js';
import { nflTeams } from '../data/nfl-teams.js';
import { HttpError } from '../lib/http-error.js';

type ScheduleRow = {
  game_id?: string; season?: string; game_type?: string; week?: string; gameday?: string;
  weekday?: string; gametime?: string; away_team?: string; home_team?: string;
};
type IdRow = RowDataPacket & { id: number; abbreviation?: string; week_number?: number };

export async function importScheduleCsv(csv: string, seasonYear: number, userId: number, source: string): Promise<{ teams: number; weeks: number; games: number }> {
  let records: ScheduleRow[];
  try { records = parse(csv, { columns: true, skip_empty_lines: true, trim: true, bom: true, relax_column_count: true }); }
  catch { throw new HttpError(400, 'The schedule file is not valid CSV'); }
  const games = records.filter(row => Number(row.season) === seasonYear && row.game_type === 'REG');
  if (!games.length) throw new HttpError(400, `No ${seasonYear} regular-season games were found`);
  for (const game of games) {
    if (!game.game_id || !game.week || !game.gameday || !game.gametime || !game.away_team || !game.home_team) {
      throw new HttpError(400, 'Schedule rows must include game_id, season, game_type, week, gameday, gametime, away_team, and home_team');
    }
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    for (const [abbr, city, name] of nflTeams) {
      await connection.execute(
        `INSERT INTO teams (abbreviation, city, name, logo_url) VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE city=VALUES(city), name=VALUES(name), logo_url=COALESCE(teams.logo_url, VALUES(logo_url))`,
        [abbr, city, name, `/logos/${abbr}.png`]
      );
    }
    await connection.execute(
      `INSERT INTO seasons (year, name) VALUES (?, ?) ON DUPLICATE KEY UPDATE name=VALUES(name)`,
      [seasonYear, `${seasonYear} Regular Season`]
    );
    const [seasonRows] = await connection.query<IdRow[]>('SELECT id FROM seasons WHERE year=?', [seasonYear]);
    const seasonId = seasonRows[0]!.id;
    const weekNumbers = [...new Set(games.map(game => Number(game.week)))].sort((a,b) => a-b);
    for (const weekNumber of weekNumbers) {
      const weekGames = games.filter(game => Number(game.week) === weekNumber);
      const kickoffTimes = weekGames.map(game => toUtc(game.gameday!, game.gametime!));
      const lockAt = new Date(Math.min(...kickoffTimes.map(value => value.getTime())));
      await connection.execute(
        `INSERT INTO weeks (season_id, week_number, name, picks_lock_at, status) VALUES (?, ?, ?, ?, 'open')
         ON DUPLICATE KEY UPDATE name=VALUES(name), picks_lock_at=IF(status IN ('draft','open'),VALUES(picks_lock_at),picks_lock_at)`,
        [seasonId, weekNumber, `Week ${weekNumber}`, lockAt]
      );
    }
    const [teamRows] = await connection.query<IdRow[]>('SELECT id, abbreviation FROM teams');
    const teamIds = new Map(teamRows.map(row => [row.abbreviation!, row.id]));
    const [weekRows] = await connection.query<IdRow[]>('SELECT id, week_number FROM weeks WHERE season_id=?', [seasonId]);
    const weekIds = new Map(weekRows.map(row => [row.week_number!, row.id]));
    for (const game of games) {
      const awayId = teamIds.get(game.away_team!); const homeId = teamIds.get(game.home_team!); const weekId = weekIds.get(Number(game.week));
      if (!awayId || !homeId || !weekId) throw new HttpError(400, `Unknown team code in ${game.game_id}`);
      await connection.execute(
        `INSERT INTO games (external_id, week_id, away_team_id, home_team_id, kickoff_at)
         VALUES (?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE week_id=VALUES(week_id), away_team_id=VALUES(away_team_id),
         home_team_id=VALUES(home_team_id), kickoff_at=IF(status='scheduled',VALUES(kickoff_at),kickoff_at)`,
        [game.game_id!, weekId, awayId, homeId, toUtc(game.gameday!, game.gametime!)]
      );
    }
    for (const weekNumber of weekNumbers) {
      const weekId = weekIds.get(weekNumber)!;
      await connection.execute('UPDATE games SET is_monday_tiebreaker=FALSE WHERE week_id=?', [weekId]);
      const mondayGames = games.filter(game => Number(game.week) === weekNumber && game.weekday?.toLowerCase() === 'monday')
        .sort((a,b) => toUtc(b.gameday!, b.gametime!).getTime() - toUtc(a.gameday!, a.gametime!).getTime());
      const finalGame = games.filter(game => Number(game.week) === weekNumber)
        .sort((a,b) => toUtc(b.gameday!, b.gametime!).getTime() - toUtc(a.gameday!, a.gametime!).getTime())[0];
      const tiebreaker = mondayGames[0] ?? finalGame;
      if (tiebreaker) await connection.execute('UPDATE games SET is_monday_tiebreaker=TRUE WHERE external_id=?', [tiebreaker.game_id!]);
    }
    await connection.execute<ResultSetHeader>('INSERT INTO schedule_imports (season_year, source, games_seen, imported_by) VALUES (?, ?, ?, ?)', [seasonYear, source, games.length, userId]);
    await connection.commit();
    return { teams: nflTeams.length, weeks: weekNumbers.length, games: games.length };
  } catch (error) { await connection.rollback(); throw error; }
  finally { connection.release(); }
}

function toUtc(date: string, time: string): Date {
  const parsed = DateTime.fromISO(`${date}T${time}`, { zone: 'America/New_York' });
  if (!parsed.isValid) throw new HttpError(400, `Invalid kickoff time: ${date} ${time}`);
  return parsed.toUTC().toJSDate();
}
