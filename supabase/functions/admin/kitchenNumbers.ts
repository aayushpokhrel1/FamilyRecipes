// This module exists because Vitest cannot import the Deno entry point, which is why
// `extract-recipe` is split into a pure module and an I/O module. The definitions
// here must match `supabase/migrations/0063_the_kitchen_can_see_its_own_throughput.sql`
// exactly, because the console and the in-app page must not disagree about the same
// group.

export type KitchenThroughput = {
  started: number;
  landed: number;
  medianDays: number | null;
  slowOverAMonth: number;
};

export function kitchenThroughput(
  dishes: { id: string }[],
  versions: { dish_id: string; created_at: string }[],
  approvals: { version_id: string; approved_at: string }[],
  now?: Date,
): KitchenThroughput {
  const dishIds = new Set(dishes.map((d) => d.id));
  const firstVersions = new Map<string, string>();
  const firstApprovals = new Map<string, string>();

  // Find the first version for each dish
  for (const version of versions) {
    if (dishIds.has(version.dish_id) && !firstVersions.has(version.dish_id)) {
      firstVersions.set(version.dish_id, version.created_at);
    }
  }

  // Find the first approval for each dish
  for (const approval of approvals) {
    const version = versions.find((v) => v.id === approval.version_id);
    if (version && dishIds.has(version.dish_id) && !firstApprovals.has(version.dish_id)) {
      firstApprovals.set(version.dish_id, approval.approved_at);
    }
  }

  // Calculate intervals and filter dishes with both first version and first approval
  const intervals: number[] = [];
  for (const dishId of dishIds) {
    const firstVersion = firstVersions.get(dishId);
    const firstApproval = firstApprovals.get(dishId);
    if (firstVersion && firstApproval) {
      const versionDate = new Date(firstVersion);
      const approvalDate = new Date(firstApproval);
      const interval = (approvalDate.getTime() - versionDate.getTime()) / (1000 * 60 * 60 * 24);
      intervals.push(interval);
    }
  }

  // Calculate median days
  let medianDays: number | null = null;
  if (intervals.length > 0) {
    intervals.sort((a, b) => a - b);
    const middle = Math.floor(intervals.length / 2);
    if (intervals.length % 2 === 0) {
      medianDays = (intervals[middle - 1] + intervals[middle]) / 2;
    } else {
      medianDays = intervals[middle];
    }
    medianDays = Math.round(medianDays * 10) / 10;
  }

  // Count dishes with no approval and an old first version
  const currentTime = now ?? new Date();
  let slowOverAMonth = 0;
  for (const dishId of dishIds) {
    const firstVersion = firstVersions.get(dishId);
    if (firstVersion && !firstApprovals.has(dishId)) {
      const versionDate = new Date(firstVersion);
      const daysOld = (currentTime.getTime() - versionDate.getTime()) / (1000 * 60 * 60 * 24);
      if (daysOld > 30) {
        slowOverAMonth++;
      }
    }
  }

  return {
    started: dishes.length,
    landed: firstApprovals.size,
    medianDays,
    slowOverAMonth,
  };
}

export function activeStaffCount(activity: { user_id: string }[]): number {
  const uniqueUserIds = new Set(activity.map((a) => a.user_id));
  return uniqueUserIds.size;
}