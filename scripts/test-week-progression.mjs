import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {app} from '../dist/app.js';
import {pool} from '../dist/db/pool.js';
import {queueReminders} from '../dist/services/email-outbox.js';
const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
const base=`http://127.0.0.1:${server.address().port}`;
let userId,groupId,seasonId,cookie;const weeks=[],games=[];
async function call(path,method='GET',body,status=200) {
  const response=await fetch(base+'/api/'+path,{method,headers:{'content-type':'application/json',...(cookie?{cookie}:{})},body:body?JSON.stringify(body):undefined});
  const data=await response.json();assert.equal(response.status,status,JSON.stringify(data));
  cookie=response.headers.get('set-cookie')?.split(';')[0]??cookie;return data;
}
try {
  userId=(await call('auth/register','POST',{email:`progress-${randomUUID()}@example.invalid`,displayName:'Progress test',password:'ProgressTest!2026',confirmPassword:'ProgressTest!2026',acceptTerms:true},201)).id;
  groupId=(await call('groups','POST',{name:'Progress '+randomUUID()},201)).id;
  const [existing]=await pool.query('SELECT year FROM seasons');const year=Array.from({length:80},(_,i)=>2020+i).find(y=>!existing.some(row=>row.year===y));
  const [season]=await pool.execute('INSERT INTO seasons (year,name) VALUES (?,?)',[year,'Progress test']);seasonId=season.insertId;
  const [teams]=await pool.query('SELECT id FROM teams ORDER BY id LIMIT 2');
  for(let number=1;number<=3;number++) {
    const [week]=await pool.execute("INSERT INTO weeks (season_id,week_number,name,picks_lock_at,status) VALUES (?,?,?,DATE_ADD(UTC_TIMESTAMP(),INTERVAL 12 HOUR),'open')",[seasonId,number,`Progress week ${number}`]);weeks.push(week.insertId);
    const [game]=await pool.execute('INSERT INTO games (week_id,home_team_id,away_team_id,kickoff_at,is_monday_tiebreaker) VALUES (?,?,?,DATE_ADD(UTC_TIMESTAMP(),INTERVAL 12 HOUR),TRUE)',[week.insertId,teams[0].id,teams[1].id]);games.push(game.insertId);
  }
  const path=`groups/${groupId}`;
  const picks=i=>({picks:[{gameId:games[i],teamId:teams[0].id}],tiebreakerTotal:42});
  await call(`${path}/weeks/${weeks[0]}/entry`,'PUT',picks(0));
  await call(`${path}/weeks/${weeks[1]}/entry`,'PUT',picks(1),409);
  await call(`${path}/weeks/${weeks[2]}/entry`,'PUT',picks(2),409);
  const detail=await call(`${path}/weeks/${weeks[1]}`);assert.equal(detail.week.previousWeeksFinal,0);
  await queueReminders(pool);
  const [reminders]=await pool.query("SELECT week_id FROM email_outbox WHERE user_id=? AND kind='reminder'",[userId]);assert.deepEqual(reminders.map(row=>row.week_id),[weeks[0]]);
  // An existing future draft must not bypass submission restrictions.
  const [draft]=await pool.execute('INSERT INTO entries (user_id,group_id,week_id,entry_number,tiebreaker_total) VALUES (?,?,?,1,42)',[userId,groupId,weeks[1]]);
  await pool.execute('INSERT INTO picks (entry_id,game_id,selected_team_id) VALUES (?,?,?)',[draft.insertId,games[1],teams[0].id]);
  await call(`${path}/entries/${draft.insertId}/submit-review`,'POST',undefined,409);
  await pool.execute("UPDATE weeks SET status='final' WHERE id=?",[weeks[0]]);
  const list=await call(`${path}/weeks`);assert.equal(list.find(row=>row.id===weeks[1]).previousWeeksFinal,1);assert.equal(list.find(row=>row.id===weeks[2]).previousWeeksFinal,0);
  await call(`${path}/weeks/${weeks[0]}/entry`,'PUT',picks(0),409);
  await call(`${path}/weeks/${weeks[1]}/entry`,'PUT',{...picks(1),entryId:draft.insertId});
  await call(`${path}/entries/${draft.insertId}/submit-review`,'POST');
  await call(`${path}/weeks/${weeks[2]}/entry`,'PUT',picks(2),409);
  await pool.execute("UPDATE weeks SET status='final' WHERE id=?",[weeks[1]]);
  await pool.execute('UPDATE weeks SET picks_lock_at=DATE_SUB(UTC_TIMESTAMP(),INTERVAL 1 HOUR) WHERE id=?',[weeks[2]]);
  await call(`${path}/weeks/${weeks[2]}/entry`,'PUT',picks(2),409);
  console.log('PASS: sequential unlocking, deadline enforcement, completed locks, future-draft submission blocking, list/detail metadata and reminder eligibility.');
} finally {
  if(groupId) {
    await pool.execute('DELETE n FROM notifications n JOIN entries e ON e.id=n.entry_id WHERE e.group_id=?',[groupId]);
    await pool.execute('DELETE FROM entries WHERE group_id=?',[groupId]);
    await pool.execute('DELETE FROM group_members WHERE group_id=?',[groupId]);
    await pool.execute('DELETE FROM pool_groups WHERE id=?',[groupId]);
  }
  for(const id of weeks){await pool.execute('DELETE FROM games WHERE week_id=?',[id]);await pool.execute('DELETE FROM weeks WHERE id=?',[id]);}
  if(seasonId)await pool.execute('DELETE FROM seasons WHERE id=?',[seasonId]);
  if(userId){await pool.execute('DELETE FROM sessions WHERE user_id=?',[userId]);await pool.execute('DELETE FROM users WHERE id=?',[userId]);}
  await new Promise(r=>server.close(r));await pool.end();
}
