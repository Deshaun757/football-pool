import { app } from './app.js';
import { config } from './config.js';
import { pool } from './db/pool.js';
import { migrateDatabase } from './db/migrate.js';
import { startEmailWorker } from './services/email-outbox.js';

// Hostinger's loader uses require(); keep the entry module free of top-level await.
async function start(): Promise<void> {
  await pool.query('SELECT 1');
  try {
    await migrateDatabase();
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Database migration failed');
    throw error;
  }
  const server = app.listen(config.PORT, () => console.log(`Pick’em API listening on port ${config.PORT}`));
  const emailTimer = startEmailWorker();
  server.on('close', () => clearInterval(emailTimer));
}

void start().catch(async (error: unknown) => {
  // Report the error code without exposing credentials from connection settings.
  const code = (error as { code?: string })?.code ?? 'UNKNOWN';
  console.error(`Application startup failed (${code}). Check database connectivity and MYSQL_URL.`);
  await pool.end();
  process.exitCode = 1;
});
