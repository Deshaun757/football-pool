import mysql from 'mysql2/promise';

const mysqlUrl = process.env.MYSQL_URL;
if (!mysqlUrl) throw new Error('Set MYSQL_URL before running this script.');

const updateLatest = process.argv.includes('--update-latest');
const minutesArgument = process.argv.find((argument) => /^\d+$/.test(argument));
const minutes = Number(minutesArgument ?? 6);
if (!Number.isFinite(minutes) || minutes < 1 || minutes > 60) {
  throw new Error('Pass a lock time between 1 and 60 minutes.');
}

const db = await mysql.createConnection(mysqlUrl);
const toMysqlUtc = (date) =>
  date.toISOString().slice(0, 23).replace('T', ' ');

try {
  const suffix = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 12);
  const year = 2098;
  const lockAt = new Date(Date.now() + minutes * 60 * 1000);
  const kickoffAt = new Date(Date.now() + (minutes + 2) * 60 * 1000);
  const matchups = [
    ['BUF', 'NE', true],
    ['DAL', 'PHI', false],
    ['KC', 'DEN', false],
    ['SF', 'SEA', false],
    ['MIA', 'NYJ', false],
  ];

  await db.beginTransaction();
  if (updateLatest) {
    const [[latestWeek]] = await db.query(
      "SELECT id,name FROM weeks WHERE name LIKE 'Live Test Week %' ORDER BY id DESC LIMIT 1",
    );
    if (!latestWeek) throw new Error('No live test week found to update.');
    await db.execute("UPDATE weeks SET picks_lock_at=?,status='open' WHERE id=?", [
      toMysqlUtc(lockAt),
      latestWeek.id,
    ]);
    await db.execute("UPDATE games SET kickoff_at=?,status='scheduled',home_score=NULL,away_score=NULL WHERE week_id=?", [
      toMysqlUtc(kickoffAt),
      latestWeek.id,
    ]);
    await db.commit();
    console.log(JSON.stringify({
      weekId: latestWeek.id,
      weekName: latestWeek.name,
      locksAtUtc: lockAt.toISOString(),
      locksAtEastern: new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/New_York',
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(lockAt),
      updated: true,
    }, null, 2));
    process.exit(0);
  }

  await db.execute(
    'INSERT INTO seasons (year,name) VALUES (?,?) ON DUPLICATE KEY UPDATE name=VALUES(name)',
    [year, 'Live test season'],
  );
  const [[season]] = await db.query('SELECT id FROM seasons WHERE year=?', [year]);
  const [[weekNumber]] = await db.query(
    'SELECT COALESCE(MAX(week_number),0)+1 AS nextWeek FROM weeks WHERE season_id=?',
    [season.id],
  );
  const [weekResult] = await db.execute(
    "INSERT INTO weeks (season_id,week_number,name,picks_lock_at,status) VALUES (?,?,?,?, 'open')",
    [season.id, weekNumber.nextWeek, `Live Test Week ${suffix}`, toMysqlUtc(lockAt)],
  );
  const weekId = weekResult.insertId;
  const [teams] = await db.query(
    "SELECT id,abbreviation FROM teams WHERE abbreviation IN ('BUF','NE','DAL','PHI','KC','DEN','SF','SEA','MIA','NYJ')",
  );
  const teamsByAbbreviation = Object.fromEntries(teams.map((team) => [team.abbreviation, team.id]));

  for (const [away, home, isTiebreaker] of matchups) {
    if (!teamsByAbbreviation[away] || !teamsByAbbreviation[home]) {
      throw new Error(`Missing team ${away} or ${home}. Import teams before creating live test games.`);
    }
    await db.execute(
      "INSERT INTO games (week_id,away_team_id,home_team_id,kickoff_at,is_monday_tiebreaker,status) VALUES (?,?,?,?,?,'scheduled')",
      [weekId, teamsByAbbreviation[away], teamsByAbbreviation[home], toMysqlUtc(kickoffAt), isTiebreaker],
    );
  }

  await db.commit();
  console.log(JSON.stringify({
    weekId,
    weekName: `Live Test Week ${suffix}`,
    locksAtUtc: lockAt.toISOString(),
    games: matchups.map(([away, home, isTiebreaker]) => `${away} at ${home}${isTiebreaker ? ' (Monday tiebreaker)' : ''}`),
  }, null, 2));
} catch (error) {
  await db.rollback();
  throw error;
} finally {
  await db.end();
}
