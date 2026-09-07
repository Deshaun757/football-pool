// Integration checks against the configured local database. All fixtures are removed in finally.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { app } from '../dist/app.js';
import { pool } from '../dist/db/pool.js';
import { queueReminders } from '../dist/services/email-outbox.js';
const server = app.listen(0, '127.0.0.1');
await new Promise(resolve => server.once('listening', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const suffix = randomBytes(6).toString('hex');
const users = [], groups = [];
let seasonId, weekId;
async function call(cookie, path, method = 'GET', body, status = 200) {
  const response = await fetch(base + path, {method, headers: {'content-type':'application/json', ...(cookie ? {cookie} : {})}, body: body ? JSON.stringify(body) : undefined});
  const data = await response.json().catch(() => null);
  assert.equal(response.status, status, `${method} ${path}: ${JSON.stringify(data)}`);
  return {data, cookie: response.headers.get('set-cookie')?.split(';')[0]};
}
async function register(name) {
  const result = await call(null, '/api/auth/register', 'POST', {acceptTerms:true,email:`groups-${suffix}-${name}@example.invalid`,displayName:`Test ${name}`,password:'IntegrationPass!2026',confirmPassword:'IntegrationPass!2026'},201);
  users.push(result.data.id);
  return {...result.data,cookie:result.cookie};
}
async function create(user,name) {
  const {data} = await call(user.cookie,'/api/groups','POST',{name},201);
  groups.push(data.id);
  return data.id;
}
try {
  const ownerA=await register('ownerA'), ownerB=await register('ownerB'), member=await register('member'), admin=await register('admin');
  await pool.execute("UPDATE users SET role='admin' WHERE id=?",[admin.id]);
  assert.deepEqual((await call(member.cookie,'/api/groups')).data,[]);
  const a=await create(ownerA,'Group A'), b=await create(ownerB,'Group B');
  const [welcome]=await pool.query("SELECT * FROM email_outbox WHERE user_id=? AND kind='welcome'",[member.id]);
  assert.equal(welcome.length,1);
  await call(member.cookie,`/api/groups/${a}/invitations`,'POST',{email:'invite@example.invalid'},403);
  await call(ownerA.cookie,`/api/groups/${a}/invitations`,'POST',{email:'invalid'},400);
  await call(ownerA.cookie,`/api/groups/${a}/invitations`,'POST',{email:`invite-${suffix}@example.invalid`},202);
  await call(ownerA.cookie,`/api/groups/${a}/invitations`,'POST',{email:`invite-${suffix}@example.invalid`},429);
  await call(ownerB.cookie,'/api/groups','POST',{name:'  gRoUp   a  '},409);
  const listA=(await call(ownerA.cookie,'/api/groups')).data;
  assert.equal(listA.length,1);
  assert.equal(listA[0].role,'commissioner');
  assert.equal((await call(ownerA.cookie,'/api/auth/me')).data.role,'player');
  await call(ownerA.cookie,'/api/admin/teams','GET',undefined,403);
  await call(member.cookie,`/api/groups/${a}/weeks`,'GET',undefined,403);
  await call(member.cookie,'/api/groups/join','POST',{inviteCode:'0'.repeat(32)},404);
  await Promise.all([1,2].map(()=>call(member.cookie,'/api/groups/join','POST',{inviteCode:listA[0].inviteCode})));
  await call(ownerA.cookie,'/api/groups/join','POST',{inviteCode:listA[0].inviteCode});
  const [joinMail]=await pool.query("SELECT recipient,body FROM email_outbox WHERE group_id=? AND kind='member_joined'",[a]);
  assert.equal(joinMail.length,1,'Concurrent joins and existing members must not duplicate notices');
  assert.equal(joinMail[0].recipient,ownerA.email);
  assert.ok(joinMail[0].body.includes(member.displayName));
  assert.ok(joinMail[0].body.includes('Group A'));
  assert.equal((await call(member.cookie,'/api/groups')).data[0].inviteCode,null);
  assert.equal((await call(ownerA.cookie,`/api/groups/${a}/members`)).data.length,2);
  assert.ok((await call(ownerA.cookie,`/api/groups/${a}/members`)).data.some(row=>row.email===member.email));
  assert.ok((await call(member.cookie,`/api/groups/${a}/members`)).data.every(row=>!('email' in row)));
  await call(member.cookie,`/api/groups/${a}/members/${ownerA.id}`,'DELETE',undefined,403);
  await call(ownerB.cookie,`/api/groups/${a}/members/${member.id}`,'DELETE',undefined,403);
  await call(ownerA.cookie,`/api/groups/${a}/members/${ownerA.id}`,'DELETE',undefined,409);
  await call(member.cookie,`/api/groups/${a}/reviews`,'GET',undefined,403);
  await call(ownerB.cookie,`/api/groups/${a}/members`,'GET',undefined,403);
  const inviteB=(await call(ownerB.cookie,'/api/groups')).data[0].inviteCode;
  await call(member.cookie,'/api/groups/join','POST',{inviteCode:inviteB});
  const [seasons]=await pool.query('SELECT year FROM seasons');
  const year=Array.from({length:80},(_,i)=>2020+i).find(year=>!seasons.some(row=>row.year===year));
  const [season]=await pool.execute('INSERT INTO seasons (year,name) VALUES (?,?)',[year,`Group test ${suffix}`]);
  seasonId=season.insertId;
  const [week]=await pool.execute("INSERT INTO weeks (season_id,week_number,name,picks_lock_at,status) VALUES (?,1,?,DATE_ADD(UTC_TIMESTAMP(),INTERVAL 1 DAY),'open')",[seasonId,`Group test ${suffix}`]);
  weekId=week.insertId;
  const [teams]=await pool.query('SELECT id FROM teams ORDER BY id LIMIT 2');
  assert.equal(teams.length,2,'Import teams before running this integration test');
  const [game]=await pool.execute('INSERT INTO games (week_id,home_team_id,away_team_id,kickoff_at,is_monday_tiebreaker) VALUES (?,?,?,DATE_ADD(UTC_TIMESTAMP(),INTERVAL 1 DAY),TRUE)',[weekId,teams[0].id,teams[1].id]);
  await queueReminders(pool);
  await queueReminders(pool);
  const [reminders]=await pool.query("SELECT * FROM email_outbox WHERE week_id=? AND kind='reminder'",[weekId]);
  assert.equal(reminders.filter(mail=>[a,b].includes(mail.group_id)).length,4,'One reminder per membership, even after repeated scans');
  async function save(groupId,teamId,tiebreaker=42) {
    return (await call(member.cookie,`/api/groups/${groupId}/weeks/${weekId}/entry`,'PUT',{picks:[{gameId:game.insertId,teamId}],tiebreakerTotal:tiebreaker})).data;
  }
  const entryA=await save(a,teams[0].id), entryB=await save(b,teams[1].id);
  assert.equal(entryA.entryNumber,1); assert.equal(entryB.entryNumber,1);
  assert.equal((await call(member.cookie,`/api/groups/${a}/my-entries`)).data.length,1);
  await call(member.cookie,`/api/groups/${b}/entries/${entryA.id}/submit-review`,'POST',undefined,409);
  await call(member.cookie,`/api/groups/${b}/weeks/${weekId}/entry`,'PUT',{entryId:entryA.id,picks:[{gameId:game.insertId,teamId:teams[0].id}],tiebreakerTotal:42},409);
  for (const [id,entry] of [[a,entryA],[b,entryB]]) await call(member.cookie,`/api/groups/${id}/entries/${entry.id}/submit-review`,'POST');
  assert.equal((await call(ownerA.cookie,`/api/groups/${a}/reviews`)).data.length,1);
  assert.equal((await call(ownerA.cookie,`/api/groups/${a}/notifications`)).data.unreadCount,1);
  await call(ownerA.cookie,`/api/groups/${a}/reviews/${entryB.id}/approve`,'POST',undefined,409);
  await call(ownerB.cookie,`/api/groups/${a}/reviews/${entryA.id}/approve`,'POST',undefined,403);
  await call(member.cookie,`/api/groups/${a}/reviews/${entryA.id}/approve`,'POST',undefined,403);
  await call(ownerA.cookie,`/api/groups/${a}/reviews/${entryA.id}/reject`,'POST',{reason:'Please check your tiebreaker'});
  await call(member.cookie,`/api/groups/${a}/entries/${entryA.id}/submit-review`,'POST');
  await call(ownerA.cookie,`/api/groups/${a}/reviews/${entryA.id}/approve`,'POST');
  await call(ownerB.cookie,`/api/groups/${b}/reviews/${entryB.id}/approve`,'POST');
  const [decisions]=await pool.query("SELECT * FROM email_outbox WHERE user_id=? AND kind='pick_decision' ORDER BY id",[member.id]);
  assert.equal(decisions.length,3,'Only successful decisions queue emails');
  assert.ok(decisions[0].body.includes('Please check your tiebreaker'));
  assert.equal((await call(member.cookie,`/api/groups/${a}/weeks/${weekId}/leaderboard`)).data.length,1);
  assert.equal((await call(member.cookie,`/api/groups/${a}/weeks/${weekId}/leaderboard`)).data[0].tiebreakerTotal,null);
  const noticesA=(await call(member.cookie,`/api/groups/${a}/notifications`)).data;
  assert.ok(noticesA.notifications.every(n=>n.entryId===entryA.id));
  await call(member.cookie,`/api/groups/${a}/notifications/read-all`,'POST',undefined,204);
  assert.equal((await call(member.cookie,`/api/groups/${b}/notifications`)).data.unreadCount,1);
  await pool.execute('UPDATE weeks SET picks_lock_at=UTC_TIMESTAMP() WHERE id=?',[weekId]);
  const boardA=(await call(member.cookie,`/api/groups/${a}/picks-board`)).data;
  assert.equal(boardA.entries.length,1); assert.equal(boardA.entries[0].id,entryA.id);
  await call(ownerA.cookie,`/api/admin/games/${game.insertId}/result`,'PATCH',{homeScore:30,awayScore:12},403);
  await call(admin.cookie,`/api/admin/games/${game.insertId}/result`,'PATCH',{homeScore:30,awayScore:12});
  assert.equal((await call(admin.cookie,`/api/admin/weeks/${weekId}/score`,'POST')).data.winners,2);
  const [results]=await pool.query('SELECT group_id,winning_correct_picks FROM weekly_results WHERE week_id=? ORDER BY group_id',[weekId]);
  assert.deepEqual(results.map(r=>r.winning_correct_picks),[1,0]);
  await call(admin.cookie,`/api/admin/weeks/${weekId}/score`,'POST');
  const [resultMail]=await pool.query("SELECT * FROM email_outbox WHERE week_id=? AND kind='results'",[weekId]);
  assert.equal(resultMail.length,4,'Unchanged rescoring does not repeat results emails');
  assert.ok(resultMail.every(mail=>mail.body.includes('Test member')));
  assert.ok((await call(admin.cookie,'/api/groups')).data.some(g=>g.id===a));
  await call(admin.cookie,`/api/groups/${b}/reviews`);
  await call(member.cookie,'/api/weeks','GET',undefined,404);
  // Reopen only this test fixture to exercise submission settings.
  await pool.execute("UPDATE weeks SET status='open',picks_lock_at=DATE_ADD(UTC_TIMESTAMP(),INTERVAL 1 DAY) WHERE id=?",[weekId]);
  await pool.execute("UPDATE games SET status='scheduled' WHERE week_id=?",[weekId]);
  const ownerEntry=(await call(ownerA.cookie,`/api/groups/${a}/weeks/${weekId}/entry`,'PUT',{picks:[{gameId:game.insertId,teamId:teams[0].id}],tiebreakerTotal:42})).data;
  assert.equal((await call(ownerA.cookie,`/api/groups/${a}/entries/${ownerEntry.id}/submit-review`,'POST')).data.status,'submitted');
  const pending=await save(a,teams[0].id);
  await call(member.cookie,`/api/groups/${a}/entries/${pending.id}/submit-review`,'POST');
  const settings={requirePickApproval:false,allowMultipleEntries:false,joiningEnabled:false};
  await call(member.cookie,`/api/groups/${a}/settings`,'PATCH',settings,403);
  await call(ownerB.cookie,`/api/groups/${a}/settings`,'PATCH',settings,403);
  await call(ownerA.cookie,`/api/groups/${a}/settings`,'PATCH',settings);
  await call(ownerA.cookie,`/api/groups/${a}/invitations`,'POST',{email:`closed-${suffix}@example.invalid`},409);
  assert.equal((await call(ownerA.cookie,`/api/groups/${a}/reviews`)).data[0].entryId,pending.id);
  await call(member.cookie,`/api/groups/${a}/weeks/${weekId}/entry`,'PUT',{picks:[{gameId:game.insertId,teamId:teams[0].id}],tiebreakerTotal:42},409);
  await call(ownerB.cookie,'/api/groups/join','POST',{inviteCode:listA[0].inviteCode},409);
  await call(member.cookie,'/api/groups/join','POST',{inviteCode:listA[0].inviteCode});
  await call(member.cookie,`/api/groups/${a}/invite-code`,'POST',undefined,403);
  const rotated=(await call(ownerA.cookie,`/api/groups/${a}/invite-code`,'POST')).data.inviteCode;
  await call(ownerA.cookie,`/api/groups/${a}/settings`,'PATCH',{...settings,allowMultipleEntries:true,joiningEnabled:true});
  await call(ownerB.cookie,'/api/groups/join','POST',{inviteCode:listA[0].inviteCode},404);
  await call(ownerB.cookie,'/api/groups/join','POST',{inviteCode:rotated});
  const automatic=await save(a,teams[0].id);
  assert.equal((await call(member.cookie,`/api/groups/${a}/entries/${automatic.id}/submit-review`,'POST')).data.status,'submitted');
  assert.equal((await call(ownerB.cookie,'/api/groups')).data.find(g=>g.id===b).requirePickApproval,1);
  console.log('PASS: commissioner self-submission, settings permissions, automatic member submission, pending queue preservation, entry limits, closed joining, invite rotation');
  console.log('PASS: create/join, roles, group isolation, review decisions, notifications, independent winners, admin oversight');
  await call(ownerA.cookie,`/api/groups/${a}/members/${member.id}`,'DELETE');
  await call(member.cookie,`/api/groups/${a}/members`,'GET',undefined,403);
  await call(member.cookie,`/api/groups/${b}/members`);
  const [preserved]=await pool.query('SELECT id FROM entries WHERE group_id=? AND user_id=?',[a,member.id]);
  assert.ok(preserved.length>0);
  await call(ownerA.cookie,`/api/groups/${a}/members/${member.id}`,'DELETE',undefined,404);
  console.log('PASS: commissioner-only email visibility and removal, commissioner protection, preserved entries, revoked group access and unaffected other memberships');
  console.log('PASS: welcome emails, invitation permissions and cooldown, review emails, reminder deduplication, results recipients and rescoring deduplication');
} finally {
  // Delete only fixtures whose IDs were created by this run.
  for (const id of groups) {
    await pool.execute('DELETE n FROM notifications n JOIN entries e ON e.id=n.entry_id WHERE e.group_id=?',[id]);
    await pool.execute('DELETE ww FROM weekly_winners ww JOIN entries e ON e.id=ww.entry_id WHERE e.group_id=?',[id]);
    await pool.execute('DELETE FROM weekly_results WHERE group_id=?',[id]);
    await pool.execute('DELETE p FROM picks p JOIN entries e ON e.id=p.entry_id WHERE e.group_id=?',[id]);
    await pool.execute('DELETE FROM entries WHERE group_id=?',[id]);
    await pool.execute('DELETE FROM group_members WHERE group_id=?',[id]);
    await pool.execute('DELETE FROM pool_groups WHERE id=?',[id]);
  }
  if(weekId) { await pool.execute('DELETE FROM games WHERE week_id=?',[weekId]); await pool.execute('DELETE FROM weeks WHERE id=?',[weekId]); }
  if(seasonId) await pool.execute('DELETE FROM seasons WHERE id=?',[seasonId]);
  for(const id of users) { await pool.execute('DELETE FROM sessions WHERE user_id=?',[id]); await pool.execute('DELETE FROM users WHERE id=?',[id]); }
  await new Promise(resolve=>server.close(resolve));
  await pool.end();
}
