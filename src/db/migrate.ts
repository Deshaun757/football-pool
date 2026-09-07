import { readFile, readdir } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { RowDataPacket } from 'mysql2';
import { pool } from './pool.js';
import { logger } from '../lib/logger.js';

export async function migrateDatabase(): Promise<void> {
  const directory = fileURLToPath(new URL('../../db/migrations/', import.meta.url));
  const filenames = (await readdir(directory)).filter(name => name.endsWith('.sql')).sort();
  const connection = await pool.getConnection();
  let locked = false;
  try {
    const [locks] = await connection.query<RowDataPacket[]>("SELECT GET_LOCK(CONCAT('pickem:', LEFT(SHA2(DATABASE(),256),48)),30) AS acquired");
    if (Number(locks[0]?.acquired) !== 1) throw new Error('Timed out waiting for the database migration lock');
    locked = true;
    await connection.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      filename VARCHAR(255) NOT NULL PRIMARY KEY,
      applied_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
    ) ENGINE=InnoDB`);
    await connection.query(`CREATE TABLE IF NOT EXISTS schema_migration_failures (
      filename VARCHAR(255) NOT NULL PRIMARY KEY
    ) ENGINE=InnoDB`);
    const [applied] = await connection.query<RowDataPacket[]>('SELECT filename FROM schema_migrations');
    const pending = filenames.filter(name => !applied.some(row => row.filename === name));
    const [failed] = await connection.query<RowDataPacket[]>('SELECT filename FROM schema_migration_failures');
    if (failed.some(row => pending.includes(row.filename))) {
      throw new Error('A previous migration was interrupted. Inspect schema_migration_failures and repair the schema before restarting.');
    }
    // Check compatibility before applying any pending DDL.
    let nameCollation = 'utf8mb4_0900_as_ci';
    if (pending.includes('007_unique_group_names.sql')) {
      const [collations] = await connection.query<RowDataPacket[]>('SHOW COLLATION');
      if (!collations.some(row => row.Collation === nameCollation)) {
        if (collations.some(row => row.Collation === 'uca1400_as_ci')) nameCollation = 'uca1400_as_ci';
        else throw new Error('Group name uniqueness requires MySQL 8 or MariaDB 10.10+ with an accent-sensitive, case-insensitive collation.');
      }
    }
    for (const filename of pending) {
      let sql = await readFile(resolve(directory, filename), 'utf8');
      if (filename === '007_unique_group_names.sql') sql = sql.replaceAll('utf8mb4_0900_as_ci', nameCollation);
      if (filename === '006_groups.sql') sql = sql.replace('RANDOM_BYTES(16)', `UNHEX('${randomBytes(16).toString('hex')}')`);
      // DDL implicitly commits in MySQL/MariaDB. Mark interrupted work rather than pretending it rolls back.
      await connection.execute('INSERT INTO schema_migration_failures (filename) VALUES (?)',[filename]);
      try {
        await connection.query(sql);
        await connection.execute('INSERT INTO schema_migrations (filename) VALUES (?)',[filename]);
        await connection.execute('DELETE FROM schema_migration_failures WHERE filename=?',[filename]);
        logger.info('database_migration_applied', { filename });
      } catch (error) {
        const code = (error as {code?:string}).code ?? 'UNKNOWN';
        throw new Error(`Migration ${filename} failed (${code}). Inspect the schema before retrying.`);
      }
    }
    logger.info('database_migrations_complete', { applied: pending.length, total: filenames.length });
  } finally {
    try {
      if (locked) await connection.query("SELECT RELEASE_LOCK(CONCAT('pickem:', LEFT(SHA2(DATABASE(),256),48)))");
    } finally { connection.release(); }
  }
}

// Keep both imports and Hostinger's require() loader synchronous.
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  void migrateDatabase().catch(error => {
    logger.error('database_migration_cli_failed', { message: error instanceof Error ? error.message : 'Database migration failed' });
    process.exitCode = 1;
  }).finally(() => pool.end());
}
