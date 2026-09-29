import { supabase } from "../supabaseClient";
import type { ReportReason, ReportRow } from "./types";

// Report a public recipe. The reporter is the signed-in user, never a caller-supplied id:
// the insert policy checks reporter_id = auth.uid(), so a forged one is refused anyway.
export async function reportRecipe(
  recipeId: string,
  reason: ReportReason,
  note: string,
): Promise<void> {
  const { data } = await supabase.auth.getUser();
  if (!data.user) throw new Error("Not signed in");
  // .select("id").single() so the nudge below can name the report. Without it we would have
  // to re-query for a row we just wrote.
  const { data: row, error } = await supabase.from("reports").insert({
    recipe_id: recipeId,
    reporter_id: data.user.id,
    reason,
    note: note.trim() || null,
  }).select("id").single();
  if (error) throw new Error(error.message);

  // ponytail: best-effort notify. The report ROW above is the record; this is only a nudge,
  // so a failure here must never fail the report, hence the catch that swallows everything.
  // Calling from the client avoids pg_net, a service key stored in the database and a
  // webhook. The cost is that a tab closed at the wrong moment loses the EMAIL, never the
  // report, and /moderation still shows it. Move this to a database trigger only if a missed
  // email ever actually matters.
  try {
    await supabase.functions.invoke("notify-report", { body: { reportId: row.id } });
  } catch {
    // deliberately ignored, see above
  }
}

// Report a public cook. Same shape as reportRecipe above, and the same reason for reading
// the reporter from the session rather than taking an id. The difference is the target: a
// cook report carries cook_id and NO recipe_id key at all, because the database check is
// num_nonnulls(recipe_id, cook_id) = 1 and an explicit null would still be a key.
export async function reportCook(
  cookId: string,
  reason: ReportReason,
  note: string,
): Promise<void> {
  const { data } = await supabase.auth.getUser();
  if (!data.user) throw new Error("Not signed in");
  // .select("id").single() so the nudge below can name the report, same as reportRecipe.
  const { data: row, error } = await supabase.from("reports").insert({
    cook_id: cookId,
    reporter_id: data.user.id,
    reason,
    note: note.trim() || null,
  }).select("id").single();
  if (error) throw new Error(error.message);

  // ponytail: best-effort notify, identical to reportRecipe. The report ROW above is the
  // record; this is only a nudge, so a failure here must never fail the report, hence the
  // catch that swallows everything.
  try {
    await supabase.functions.invoke("notify-report", { body: { reportId: row.id } });
  } catch {
    // deliberately ignored, see above
  }
}

// Which of these recipes the current user has already reported. ONE call for a whole page of
// cards, never one per card: the same rule Potluck already follows for bylines and saves.
export async function myReportedIds(recipeIds: string[]): Promise<Set<string>> {
  if (!recipeIds.length) return new Set();
  const { data, error } = await supabase
    .from("reports")
    .select("recipe_id")
    .in("recipe_id", recipeIds);
  if (error) throw new Error(error.message);
  return new Set((data ?? []).map((r: { recipe_id: string }) => r.recipe_id));
}

// The moderator queue. RLS decides who actually sees rows here; a non-moderator gets an
// empty list rather than an error, which is why the page checks the flag separately.
export async function listOpenReports(): Promise<ReportRow[]> {
  const { data, error } = await supabase
    .from("reports")
    .select("*, recipes(title), profiles:cook_id(handle,public_name)")
    .eq("status", "open")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as ReportRow[];
}

// Every moderator action goes through the one RPC, which is also the only place the
// moderator check lives. The client never updates reports or recipes directly.
export async function resolveReport(
  reportId: string,
  action: "unpublish" | "suspend" | "dismiss" | "clear_name",
  reason: string,
): Promise<void> {
  const { error } = await supabase.rpc("resolve_report", {
    p_report_id: reportId,
    p_action: action,
    p_reason: reason,
  });
  if (error) throw new Error(error.message);
}
