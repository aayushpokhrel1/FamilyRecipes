// Pure filtering for alternative ingredients. No app imports.
//
// Callers must pass the rows of ONE recipe at a time. Two different recipes can
// use the same group string by coincidence, and merging them would silently drop
// an ingredient from a different dish.
export function primaryIngredients<
  T extends { position: number; alt_group?: string | null },
>(rows: T[]): T[] {
  // The lowest position wins, so the input order cannot decide it: a caller that
  // happened to hand us the rows unsorted must still get the same answer.
  const bestByGroup = new Map<string, T>();
  for (const row of rows) {
    const group = row.alt_group;
    if (!group) continue;
    const best = bestByGroup.get(group);
    if (!best || row.position < best.position) bestByGroup.set(group, row);
  }

  return rows
    .filter((row) => !row.alt_group || bestByGroup.get(row.alt_group) === row)
    .sort((a, b) => a.position - b.position);
}
