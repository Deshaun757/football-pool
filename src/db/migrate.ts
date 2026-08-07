import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pool } from './pool.js';

const connection = await pool.getConnection();

try {
  await connection.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    filename VARCHAR(255) NOT NULL PRIMARY KEY,
    applied_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
  ) ENGINE=InnoDB`);
  const directory = resolve('db/migrations');
  const filenames = (await readdir(directory)).filter((name) => name.endsWith('.sql')).sort();
  for (const filename of filenames) {
    const [rows] = await connection.query('SELECT filename FROM schema_migrations WHERE filename = ?', [filename]);
    if (Array.isArray(rows) && rows.length) continue;
    const sql = await readFile(resolve(directory, filename), 'utf8');
    await connection.beginTransaction();
    try {
      await connection.query(sql);
      await connection.execute('INSERT INTO schema_migrations (filename) VALUES (?)', [filename]);
      await connection.commit();
      console.log(`Applied ${filename}`);
    } catch (error) {
      await connection.rollback();
      throw error;
    }
  }
  console.log('Database migrations complete');
} finally {
  connection.release();
  await pool.end();
}
