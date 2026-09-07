import { app } from './app.js';
import { config } from './config.js';
import { pool } from './db/pool.js';
import { migrateDatabase } from './db/migrate.js';
import { startEmailWorker } from './services/email-outbox.js';
import { errorFields, logger } from './lib/logger.js';

// Hostinger's loader uses require(); keep the entry module free of top-level await.
async function start(): Promise<void> {
  logger.info('application_starting', { nodeEnv: config.NODE_ENV, port: config.PORT });
  await pool.query('SELECT 1');
  logger.info('database_connection_ready');
  try {
    await migrateDatabase();
  } catch (error) {
    logger.error('database_migration_failed', errorFields(error));
    throw error;
  }
  const server = app.listen(config.PORT, () => logger.info('http_server_listening', { port: config.PORT }));
  server.on('error', (error) => logger.error('http_server_error', errorFields(error)));
  const emailTimer = startEmailWorker();
  server.on('close', () => {
    clearInterval(emailTimer);
    logger.info('http_server_closed');
  });
}

void start().catch(async (error: unknown) => {
  const code = (error as { code?: string })?.code ?? 'UNKNOWN';
  logger.error('application_startup_failed', { ...errorFields(error), code });
  await pool.end();
  process.exitCode = 1;
});
