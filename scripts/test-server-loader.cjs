// Exercise the compiled entry point through require(), as Hostinger does.
const assert = require('node:assert/strict');
process.env.MYSQL_URL = 'mysql://unused:unused@127.0.0.1:3306/unused';
process.env.PORT = '3000';
const { pool } = require('../dist/db/pool.js');
const { app } = require('../dist/app.js');
let checked = false;
pool.query = async () => { checked = true; return [[], []]; };
let migrationsChecked = false;
pool.getConnection = async () => ({
  query: async sql => {
    if (sql.includes("CONCAT('mail:'")) return [[{acquired:0}],[]];
    if (sql.includes('GET_LOCK')) return [[{ acquired: 1 }], []];
    if (sql === 'SELECT filename FROM schema_migrations') {
      migrationsChecked = true;
      return [require('node:fs').readdirSync(require('node:path').resolve(__dirname,'../db/migrations')).filter(name=>name.endsWith('.sql')).map(filename=>({filename})), []];
    }
    return [[], []];
  },
  release() {},
});
const listen = app.listen.bind(app);
app.listen = (_port, callback) => {
  assert.equal(checked, true, 'Database check must precede listening');
  assert.equal(migrationsChecked, true, 'Migrations must precede listening');
  const server = listen(0, '127.0.0.1', async () => {
    try {
      callback();
      const response = await fetch(`http://127.0.0.1:${server.address().port}/health`);
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { ok: true });
      console.log('PASS: CommonJS require loads the entry point and starts the HTTP server');
    } catch (error) {
      console.error(error);
      process.exitCode = 1;
    } finally {
      server.close();
      await pool.end();
    }
  });
  return server;
};
require('../dist/server.js');
