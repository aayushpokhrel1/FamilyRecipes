import { supabase } from "../supabaseClient";
import type { MyFamily, Family } from "./types";

async function myId(): Promise<string> {
  const { data } = await supabase.auth.getUser();
  if (!data.user) throw new Error("Not signed in");
  return data.user.id;
}

// Creating a family and becoming its owner is ONE operation, so it is one RPC. It used to be
// two inserts from here, which was wrong twice over. It was not atomic: the second insert
// failing left a family nobody was a member of, and so nobody could see or join. And it
// required `family_members` to accept a direct insert, which until 0047 meant a policy that
// checked only `user_id = auth.uid()` and let anyone add themselves to ANY family as owner.
// Both legitimate paths into that table are definer functions now, and it takes none.
export async function createFamily(name: string): Promise<Family> {
  const { data, error } = await supabase.rpc("create_family", { p_name: name });
  if (error) throw new Error(error.message);
  return data as Family;
}

export async function joinByCode(code: string): Promise<Family> {
  // A non-member cannot select a family by code under RLS, so joining goes
  // through a SECURITY DEFINER RPC that looks up the family and adds the caller.
  const { data, error } = await supabase.rpc("join_family_by_code", { p_code: code });
  if (error) throw new Error(error.message);
  return data as Family;
}

export async function listMyFamilies(): Promise<MyFamily[]> {
  // role comes back with the membership and is CARRIED THROUGH: it used to be selected and
  // then dropped here, which is why RecipeDetail offered Edit and Delete on recipes the
  // viewer could not touch. The buttons need the same rule recipes_update enforces.
  const { data: memberships, error } = await supabase
    .from("family_members").select("family_id,role");
  if (error) throw new Error(error.message);
  const roles = new Map<string, "owner" | "member">(
    (memberships ?? []).map((m: any) => [m.family_id, m.role]),
  );
  const ids = [...roles.keys()];
  if (ids.length === 0) return [];
  const { data, error: fErr } = await supabase.from("families").select("*").in("id", ids);
  if (fErr) throw new Error(fErr.message);
  return (data ?? []).map((f: any) => ({ ...f, role: roles.get(f.id) ?? "member" })) as MyFamily[];
}

export async function ensureOwnKitchen(): Promise<void> {
  const { error } = await supabase.rpc("ensure_own_kitchen");
  if (error) throw new Error(error.message);
}

// NOTHING IN THE UI CALLS THIS. It is the only revocation a family invite code has: the code
// never expires, families_member_read shows it to every member, and the Families page gives
// them a Copy button, so a code that leaks is permanent until somebody rotates it and nobody
// can. Recorded in docs/OPERATIONS.md as a gap rather than quietly wired up here, because who
// may rotate (the policy says the OWNER) and what it does to links already sent is a product
// decision. 0038 calls this "the revocation" in a comment, which is true of the function and
// not of the product.
export async function rotateInviteCode(familyId: string): Promise<string> {
  const code = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
  // .select("id") for the reason updateRecipe does it: families_owner_update admits the OWNER
  // while families_member_read admits every member, so a member calling this would have been
  // handed a new code that was never stored, and would have gone on to share it.
  const { data, error } = await supabase.from("families")
    .update({ invite_code: code }).eq("id", familyId).select("id");
  if (error) throw new Error(error.message);
  if (!data || data.length === 0) throw new Error("Only your family's owner can change the invite code.");
  return code;
}

export async function leaveFamily(familyId: string): Promise<void> {
  const uid = await myId();
  const { error } = await supabase.from("family_members")
    .delete().eq("family_id", familyId).eq("user_id", uid);
  if (error) throw new Error(error.message);
}

// The name behind an invite code, so the join page can say WHICH family invited you before
// you sign in. Null means no family has that code, which is a normal answer (a wrong or a
// rotated code) rather than an error, so the page renders it instead of throwing.
export async function familyNameForCode(code: string): Promise<string | null> {
  const { data, error } = await supabase.rpc("family_name_for_code", { p_code: code });
  if (error) throw new Error(error.message);
  return (data as string | null) ?? null;
}
