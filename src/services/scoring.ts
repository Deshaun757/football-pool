export type ScoredEntry = { entryId: number; correctPicks: number; tiebreakerDifference: number };

export function findWinners(entries: ScoredEntry[]): ScoredEntry[] {
  if (!entries.length) return [];
  const sorted = [...entries].sort((a, b) =>
    b.correctPicks - a.correctPicks || a.tiebreakerDifference - b.tiebreakerDifference || a.entryId - b.entryId
  );
  const best = sorted[0]!;
  return sorted.filter((entry) => entry.correctPicks === best.correctPicks && entry.tiebreakerDifference === best.tiebreakerDifference);
}

export function splitPrize(totalCents: number, winnerIds: number[]): Map<number, number> {
  const sorted = [...winnerIds].sort((a, b) => a - b);
  if (!sorted.length) return new Map();
  const base = Math.floor(totalCents / sorted.length);
  let remainder = totalCents % sorted.length;
  return new Map(sorted.map((id) => [id, base + (remainder-- > 0 ? 1 : 0)]));
}
