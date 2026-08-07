import { describe, expect, it } from 'vitest';
import { validatePicks } from './entry-validation.js';

const games = [{ id: 1, homeTeamId: 10, awayTeamId: 11 }, { id: 2, homeTeamId: 20, awayTeamId: 21 }];

describe('validatePicks', () => {
  it('accepts exactly one participating team for every game', () => {
    expect(() => validatePicks(games, [{ gameId: 1, teamId: 10 }, { gameId: 2, teamId: 21 }])).not.toThrow();
  });

  it('rejects missing games', () => {
    expect(() => validatePicks(games, [{ gameId: 1, teamId: 10 }])).toThrow('every game');
  });

  it('rejects a team from another game', () => {
    expect(() => validatePicks(games, [{ gameId: 1, teamId: 20 }, { gameId: 2, teamId: 21 }])).toThrow('playing');
  });
});
