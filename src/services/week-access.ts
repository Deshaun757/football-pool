import type { PoolConnection } from 'mysql2/promise';
import type { RowDataPacket } from 'mysql2';
import { HttpError } from '../lib/http-error.js';

// Scope progression to a season, including unpublished earlier weeks.
export const previousWeeksFinal = (alias:string) => `NOT EXISTS (
  SELECT 1 FROM weeks previous WHERE previous.season_id=${alias}.season_id
  AND previous.week_number<${alias}.week_number AND previous.status<>'final'
)`;

export async function requirePreviousWeeksFinal(db:PoolConnection,weekId:number) {
  const [rows]=await db.query<RowDataPacket[]>(`SELECT ${previousWeeksFinal('w')} AS ready FROM weeks w WHERE w.id=?`,[weekId]);
  if(!rows[0]?.ready) throw new HttpError(409,'This week is locked until all previous weeks in the season are finalized');
}
