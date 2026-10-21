// The kitchen throughput figures, as a pure module.
//
// IT IS PURE AND IT IS BESIDE index.ts RATHER THAN INSIDE IT because Vitest cannot import that
// file: it is Deno, with remote URL imports, Deno.serve and .ts specifiers, and `tsc -b`
// excludes it for the same reason. supabase/functions/boots.test.ts can only PARSE it. So logic
// that lives in index.ts cannot be tested at all, and extract-recipe is split this way for
// exactly that reason. index.ts does the I/O and calls this.
//
// 0063_the_kitchen_can_see_its_own_throughput.sql IS THE SOURCE OF TRUTH FOR EVERY DEFINITION
// HERE. The console and a group's own Numbers page must never disagree about one group, and they
// are two implementations of the same four questions, so a change to either belongs in both.
// The migration's header explains each choice; this file only has to match it.

export type KitchenThroughput = {
  started: number;
  landed: number;
  medianDays: number | null;
  slowOverAMonth: number;
};

/** A month, for the "stuck in development" figure. The migration says `interval '1 month'`. */
const SLOW_DAYS = 30;

const DAY_MS = 86400000;

/**
 * THE ROWS ARRIVE UNORDERED, so first means EARLIEST and never "first in the array". PostgREST
 * returns whatever order the planner gives unless asked, and reading the array's first element
 * would make these figures depend on that. The migration says min(created_at) and
 * min(approved_at), so this takes minimums too.
 *
 * `versions` carries its own id because that is how approvals reach a dish: kitchen.approvals is
 * keyed by version_id (0042), so the join is approval -> version -> dish. Without the version id
 * there is no path between them at all.
 */
export function kitchenThroughput(
  dishes: { id: string }[],
  versions: { id: string; dish_id: string; created_at: string }[],
  approvals: { version_id: string; approved_at: string }[],
  now?: Date,
): KitchenThroughput {
  const known = new Set(dishes.map((d) => d.id));

  // version id -> dish id, so an approval can be attributed. A version whose dish is not in the
  // list is dropped rather than guessed at, which is the only honest option when the join key is
  // absent: index.ts fetches both sets separately and they can disagree by a row.
  const dishOfVersion = new Map<string, string>();
  const firstVersion = new Map<string, number>();
  for (const v of versions) {
    if (!known.has(v.dish_id)) continue;
    dishOfVersion.set(v.id, v.dish_id);
    const at = new Date(v.created_at).getTime();
    const held = firstVersion.get(v.dish_id);
    if (held === undefined || at < held) firstVersion.set(v.dish_id, at);
  }

  const firstApproval = new Map<string, number>();
  for (const a of approvals) {
    const dishId = dishOfVersion.get(a.version_id);
    if (dishId === undefined) continue;
    const at = new Date(a.approved_at).getTime();
    const held = firstApproval.get(dishId);
    if (held === undefined || at < held) firstApproval.set(dishId, at);
  }

  // A dish with no version has no interval, so it is counted as started and nowhere else. The
  // migration gets this for free, because its interval is NULL and the aggregate skips it.
  const intervals: number[] = [];
  for (const [dishId, approvedAt] of firstApproval) {
    const versionedAt = firstVersion.get(dishId);
    if (versionedAt === undefined) continue;
    intervals.push((approvedAt - versionedAt) / DAY_MS);
  }

  const cutoff = (now ?? new Date()).getTime() - SLOW_DAYS * DAY_MS;
  let slowOverAMonth = 0;
  for (const [dishId, versionedAt] of firstVersion) {
    if (firstApproval.has(dishId)) continue;
    if (versionedAt < cutoff) slowOverAMonth++;
  }

  return {
    // Every dish row, at every stage, a retired one included: it was still started.
    started: dishes.length,
    landed: firstApproval.size,
    medianDays: median(intervals),
    slowOverAMonth,
  };
}

/**
 * The median, matching `percentile_cont(0.5)`: the mean of the two middle values for an even
 * count, rather than one of them. Null for an empty set, which is the honest answer for a group
 * that has landed nothing and is why there is no zero here.
 */
function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const value =
    sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
  return Math.round(value * 10) / 10;
}

/**
 * How many people opened the kitchen app, NOT who.
 *
 * This is a count and it must stay one. A named person's attendance is a kitchen row, and the
 * admin function must never hand a kitchen row to a family user: that is the seal
 * supabase/kitchen_seal.test.ts exists to hold. The owner of a group sees their own staff by
 * name, inside the kitchen app, through kitchen.group_people (0065). The console never does.
 *
 * Distinct by user_id, because one person holds a row per day and per surface, and counting rows
 * would report a busy week as a crowd.
 */
export function activeStaffCount(activity: { user_id: string }[]): number {
  return new Set(activity.map((a) => a.user_id)).size;
}
