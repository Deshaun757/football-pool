import type { PoolConnection } from 'mysql2/promise';
import type { RowDataPacket } from 'mysql2';
import { HttpError } from '../lib/http-error.js';
import { verifyPassword } from '../lib/password.js';

type UserRow = RowDataPacket & { email: string; password_hash: string | null };
type IdRow = RowDataPacket & { id?: number; user_id?: number };

async function deleteGroup(connection: PoolConnection, groupId: number): Promise<void> {
  await connection.execute('DELETE ww FROM weekly_winners ww JOIN entries e ON e.id=ww.entry_id WHERE e.group_id=?',[groupId]);
  await connection.execute('DELETE p FROM payments p JOIN entries e ON e.id=p.entry_id WHERE e.group_id=?',[groupId]);
  await connection.execute('DELETE FROM entries WHERE group_id=?',[groupId]);
  await connection.execute('DELETE FROM weekly_results WHERE group_id=?',[groupId]);
  await connection.execute('DELETE FROM group_members WHERE group_id=?',[groupId]);
  await connection.execute('DELETE FROM pool_groups WHERE id=?',[groupId]);
}

export async function deleteAccount(connection: PoolConnection, userId: number, password: string): Promise<{transferredGroups:number;deletedGroups:number}> {
  const [users]=await connection.query<UserRow[]>('SELECT email,password_hash FROM users WHERE id=? FOR UPDATE',[userId]);
  const user=users[0];
  if(!user?.password_hash || !await verifyPassword(password,user.password_hash)) throw new HttpError(401,'Password is incorrect');

  const [ownedGroups]=await connection.query<IdRow[]>(`SELECT g.id FROM pool_groups g
    WHERE g.created_by=? OR EXISTS (SELECT 1 FROM group_members m WHERE m.group_id=g.id AND m.user_id=? AND m.role='commissioner')
    FOR UPDATE`,[userId,userId]);
  let transferredGroups=0,deletedGroups=0;
  for(const group of ownedGroups) {
    const groupId=Number(group.id);
    const [members]=await connection.query<IdRow[]>(`SELECT user_id FROM group_members WHERE group_id=? AND user_id<>?
      ORDER BY CASE WHEN role='commissioner' THEN 0 ELSE 1 END,joined_at,user_id LIMIT 1 FOR UPDATE`,[groupId,userId]);
    const successor=members[0]?.user_id;
    if(successor) {
      await connection.execute("UPDATE group_members SET role='commissioner' WHERE group_id=? AND user_id=?",[groupId,successor]);
      await connection.execute('UPDATE pool_groups SET created_by=? WHERE id=?',[successor,groupId]);
      transferredGroups++;
    } else {
      await deleteGroup(connection,groupId);
      deletedGroups++;
    }
  }

  await connection.execute(`DELETE wr FROM weekly_results wr JOIN
    (SELECT DISTINCT group_id,week_id FROM entries WHERE user_id=?) affected
    ON affected.group_id=wr.group_id AND affected.week_id=wr.week_id`,[userId]);
  await connection.execute('DELETE ww FROM weekly_winners ww JOIN entries e ON e.id=ww.entry_id WHERE e.user_id=?',[userId]);
  await connection.execute('DELETE p FROM payments p JOIN entries e ON e.id=p.entry_id WHERE e.user_id=?',[userId]);
  await connection.execute('DELETE FROM entries WHERE user_id=?',[userId]);
  await connection.execute('DELETE FROM schedule_imports WHERE imported_by=?',[userId]);
  await connection.execute('DELETE FROM email_outbox WHERE recipient=? OR user_id=?',[user.email,userId]);
  await connection.execute('DELETE FROM group_members WHERE user_id=?',[userId]);
  await connection.execute('DELETE FROM users WHERE id=?',[userId]);
  return {transferredGroups,deletedGroups};
}
