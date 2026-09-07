import { HttpError } from '../lib/http-error.js';

export type GameForPick = {
  id: number;
  homeTeamId: number;
  awayTeamId: number;
};

export type PickInput = { gameId: number; teamId: number };

export function validatePicks(games: GameForPick[], picks: PickInput[]): void {
  if (games.length === 0) throw new HttpError(409, 'This week has no games');
  if (picks.length !== games.length) throw new HttpError(400, `A pick is required for every game. Received ${picks.length} picks for ${games.length} games.`);

  const byGame = new Map(games.map((game) => [game.id, game]));
  const seen = new Set<number>();
  for (const pick of picks) {
    const game = byGame.get(pick.gameId);
    if (!game || seen.has(pick.gameId)) throw new HttpError(400, 'Picks contain an invalid or duplicate game');
    if (pick.teamId !== game.homeTeamId && pick.teamId !== game.awayTeamId) {
      throw new HttpError(400, 'A selected team must be playing in that game');
    }
    seen.add(pick.gameId);
  }
}
