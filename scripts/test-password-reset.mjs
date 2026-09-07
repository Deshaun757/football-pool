import assert from 'node:assert/strict';
import { randomBytes,createHash } from 'node:crypto';
import { app } from '../dist/app.js';
import { pool } from '../dist/db/pool.js';
const server=app.listen(0,'127.0.0.1');
await new Promise(resolve=>server.once('listening',resolve));
const base=`http://127.0.0.1:${server.address().port}`;
const email=`reset-${randomBytes(6).toString('hex')}@example.invalid`;
let userId,mailId;
async function post(path,body){return fetch(base+'/api/auth/'+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});}
try{
  const password='Abcdefg1!x';
  assert.equal((await post('register',{acceptTerms:true,email,displayName:'Reset test',password,confirmPassword:'no'})).status,400);
  const registration=await post('register',{acceptTerms:true,email,displayName:'Reset test',password,confirmPassword:password});
  assert.equal(registration.status,201);
  userId=(await registration.json()).id;
  const cookie=registration.headers.get('set-cookie').split(';')[0];
  const known=await post('forgot-password',{email});
  const unknown=await post('forgot-password',{email:'missing-'+email});
  assert.equal(known.status,200);assert.deepEqual(await known.json(),await unknown.json());
  const inbox=await (await fetch('http://localhost:8025/api/v2/messages?limit=100')).json();
  const mail=inbox.items.find(item=>item.Content.Headers.To.some(to=>to.includes(email)));
  assert.ok(mail,'MailHog received reset email'); mailId=mail.ID;
  const decoded=mail.Content.Body.replace(/=\r?\n/g,'').replace(/=([0-9A-F]{2})/gi,(_,hex)=>String.fromCharCode(parseInt(hex,16)));
  const token=decoded.match(/token=([a-f0-9]{64})/)[1];
  const [stored]=await pool.query('SELECT HEX(token_hash) AS hash FROM password_resets WHERE user_id=?',[userId]);
  assert.equal(stored[0].hash.toLowerCase(),createHash('sha256').update(token).digest('hex'));
  const next='AnotherPass2!';
  assert.equal((await post('reset-password',{token,password:next,confirmPassword:'bad'})).status,400);
  const attempts=await Promise.all([1,2].map(()=>post('reset-password',{token,password:next,confirmPassword:next})));
  assert.deepEqual(attempts.map(r=>r.status).sort(),[200,400]);
  const session=await fetch(base+'/api/auth/me',{headers:{cookie}});
  assert.equal(await session.json(),null);
  assert.equal((await post('login',{email,password})).status,401);
  assert.equal((await post('login',{email,password:next})).status,200);
  const expired=randomBytes(32).toString('hex');
  await pool.execute('INSERT INTO password_resets (user_id,token_hash,expires_at) VALUES (?,?,DATE_SUB(UTC_TIMESTAMP(),INTERVAL 1 MINUTE))',[userId,createHash('sha256').update(expired).digest()]);
  assert.equal((await post('reset-password',{token:expired,password:next,confirmPassword:next})).status,400);
  console.log('PASS: confirmation, 10-character password, MailHog delivery, hashed tokens, single-use concurrency, expiration, session invalidation, new login');
}finally{
  if(userId){await pool.execute('DELETE FROM sessions WHERE user_id=?',[userId]);await pool.execute('DELETE FROM users WHERE id=?',[userId]);}
  if(mailId) await fetch('http://localhost:8025/api/v1/messages/'+mailId,{method:'DELETE'});
  await new Promise(resolve=>server.close(resolve));await pool.end();
}
