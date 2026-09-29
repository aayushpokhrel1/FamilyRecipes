import { supabase } from "../supabaseClient";
import type { Report, ReportReason } from "./types";

// Report a public recipe. The reporter is the signed-in user, never a caller-supplied id:
// the insert policy checks reporter_id = auth.uid(), so a forged one is refused anyway.
export async function reportRecipe(
  recipeId: string,
  reason: ReportReason,
  note: string,
): Promise<void> {
  const { data } = await supabase.auth.getUser();
  if (!data.user) throw new Error("Not signed in");
  const { error } = await supabase.from("reports").insert({
    recipe_id: recipeId,
    reporter_id: data.user.id,
    reason,
    note: note.trim() || null,
  });
  if (error) throw new Error(error.message);
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
export async function listOpenReports(): Promise<Report[]> {
  const { data, error } = await supabase
    .from("reports")
    .select("*")
    .eq("status", "open")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as Report[];
}

// Every moderator action goes through the one RPC, which is also the only place the
// moderator check lives. The client never updates reports or recipes directly.
export async function resolveReport(
  reportId: string,
  action: "unpublish" | "suspend" | "dismiss",
  reason: string,
): Promise<void> {
  const { error } = await supabase.rpc("resolve_report", {
    p_report_id: reportId,
    p_action: action,
    p_reason: reason,
  });
  if (error) throw new Error(error.message);
}
