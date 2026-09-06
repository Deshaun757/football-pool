import { HttpError } from '../lib/http-error.js';

export async function fetchScheduleCsv(): Promise<string> {
  let response: Response;
  let csv: string;
  try {
    response = await fetch('https://github.com/nflverse/nflverse-data/releases/download/schedules/games.csv', {
      signal: AbortSignal.timeout(20_000),
    });
    csv = await response.text();
  } catch {
    throw new HttpError(502, "Could not reach nflverse. Check the server's internet access, try again, or upload games.csv below.");
  }
  if (!response.ok) {
    throw new HttpError(502, `nflverse returned HTTP ${response.status}. Try again later or upload games.csv below.`);
  }
  if (csv.length > 5_000_000) {
    throw new HttpError(502, 'The nflverse schedule exceeded the supported file size. Upload a CSV containing only the requested season.');
  }
  return csv;
}
