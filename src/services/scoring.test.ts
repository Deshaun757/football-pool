import { describe, expect, it } from 'vitest';
import { findWinners } from './scoring.js';

describe('weekly scoring', () => {
  it('uses correct picks before Monday total difference', () => {
    expect(findWinners([{ entryId: 1, correctPicks: 9, tiebreakerDifference: 0 }, { entryId: 2, correctPicks: 10, tiebreakerDifference: 8 }])).toEqual([{ entryId: 2, correctPicks: 10, tiebreakerDifference: 8 }]);
  });
  it('keeps exact co-winners', () => {
    const winners = findWinners([{ entryId: 2, correctPicks: 10, tiebreakerDifference: 2 }, { entryId: 1, correctPicks: 10, tiebreakerDifference: 2 }]);
    expect(winners).toHaveLength(2);
  });
});
