import { supabase } from "../supabaseClient";
import type { Appeal, AppealRow, AppealSubject } from "./types";

// The caller's own appeals, newest first. RLS is what scopes this to the caller: a second
// cook_id filter here would be a second copy of the same rule, and the copy is the one that
// drifts.
export async function listMyAppeals(): Promise<Appeal[]> {
  const { data, error } = await supabase
    .from("appeals")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as Appeal[];
}

// File an appeal. The appellant is the signed-in user, never a caller-supplied id: the
// insert policy checks cook_id = auth.uid(), so a forged one is refused anyway.
export async function createAppeal(
  subjectType: AppealSubject,
  subjectId: string | null,
  body: string,
): Promise<void> {
  const { data } = await supabase.auth.getUser();
  if (!data.user) throw new Error("Not signed in");
  // Mirrors the check constraint in 0035. Kept as a validator rather than a transformer: the
  // database stays the authority, this is only a nicer message.
  const trimmed = body.trim();
  if (!trimmed) throw new Error("An appeal needs a few words.");
  if (trimmed.length > 1000) throw new Error("An appeal can be at most 1000 characters.");
  const { error } = await supabase.from("appeals").insert({
    cook_id: data.user.id,
    subject_type: subjectType,
    subject_id: subjectId,
    body: trimmed,
  });
  // The partial unique index is the only authority on whether an appeal for this subject is
  // already open. Checking first and inserting second is a race; letting the index answer is
  // not.
  if (error) {
    if (error.code === "23505") throw new Error("You already have an open appeal for this.");
    throw new Error(error.message);
  }
}

// The moderator queue. RLS decides who actually sees rows here; a non-moderator gets an
// empty list rather than an error, which is why the page checks the flag separately.
export async function listOpenAppeals(): Promise<AppealRow[]> {
  const { data, error } = await supabase
    .from("appeals")
    // recipes(title) embeds, but a COOK deliberately does not: profiles_self_read hides
    // everyone else's row from a moderator too, so a profiles embed here comes back null on
    // every row. public_cooks is the only path into another profile, and the page resolves
    // the names through it.
    .select("*, recipes(title)")
    // .is, never .eq: PostgREST renders eq.null as a literal and matches nothing.
    .is("resolved_at", null)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as AppealRow[];
}

// Every resolution goes through the one RPC, which is the only place the moderator check
// lives AND the only thing that performs the undo atomically with the resolution. The client
// never updates appeals, profiles or recipes directly: two calls would be two transactions,
// and the gap between them is a state where the appeal reads as granted while the name is
// still cleared.
export async function resolveAppeal(
  id: string,
  outcome: "granted" | "declined",
  note: string,
): Promise<void> {
  const { error } = await supabase.rpc("resolve_appeal", {
    p_appeal: id,
    p_outcome: outcome,
    p_note: note.trim() || null,
  });
  if (error) throw new Error(error.message);
}
