import { supabase } from "../supabaseClient";

export type AdminStats = {
  // `users` is live LOGINS (auth.users), `everJoined` is profile ROWS. They differ by every
  // account ever deleted, because a profile outlives its login on purpose (0014): the recipe
  // keeps its author when the person leaves. Do not collapse them back into one number.
  users: number; everJoined: number;
  recipes: number; published: number; removed: number;
  families: number; openReports: number; suspended: number;
  signupsByDay: Record<string, number>;   // "YYYY-MM-DD" -> count, last 30 days
};

export type AdminUser = {
  id: string; email: string | null; emailConfirmed: boolean;
  lastSignInAt: string | null; createdAt: string; provider: string | null;
  displayName: string | null; handle: string | null;
  isModerator: boolean; suspendedAt: string | null; suspendedReason: string | null;
  recipes: number;
};

// Every call goes through the one `admin` function, which is also the only place the
// moderator check lives. The browser deliberately does NOT re-check the caller's role, nor
// whether they are acting on themselves, nor whether they are demoting the last moderator:
// the function already refuses all three, and a second copy here would be a copy that can
// drift out of step with the one that actually enforces anything.
async function call<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("admin", { body });
  if (error) throw new Error(error.message);
  // The function reports refusals in the body with a 500, which supabase-js does not always
  // surface as an invoke error, so check the payload too. The message is the useful part
  // (it names the refusal), so it is thrown verbatim and shown to the moderator.
  if (data?.error) throw new Error(data.error);
  return data as T;
}

export function getAdminStats(): Promise<AdminStats> {
  return call<AdminStats>({ action: "stats" });
}

// Pages are 1-based, the same as the edge function, which clamps anything below 1 to 1.
export function listAdminUsers(page = 1): Promise<{ users: AdminUser[]; hasMore: boolean }> {
  return call<{ users: AdminUser[]; hasMore: boolean }>({ action: "users", page });
}

export async function suspendUser(userId: string, reason: string): Promise<void> {
  await call({ action: "suspend", userId, reason });
}

export async function unsuspendUser(userId: string): Promise<void> {
  await call({ action: "unsuspend", userId });
}

export async function setModerator(userId: string, value: boolean): Promise<void> {
  await call({ action: "set_moderator", userId, value });
}

export async function deleteUserAccount(userId: string): Promise<void> {
  await call({ action: "delete_user", userId });
}

export async function takedownRecipe(recipeId: string, reason: string): Promise<void> {
  await call({ action: "takedown_recipe", recipeId, reason });
}

export async function restoreRecipe(recipeId: string): Promise<void> {
  await call({ action: "restore_recipe", recipeId });
}
