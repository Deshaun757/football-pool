import { app } from './app.js';
import { config } from './config.js';
import { pool } from './db/pool.js';

await pool.query('SELECT 1');
app.listen(config.PORT, () => console.log(`Pick’em API listening on port ${config.PORT}`));
