import { supabase } from "../supabaseClient";
import type { Family } from "./types";

async function myId(): Promise<string> {
  const { data } = await supabase.auth.getUser();
  if (!data.user) throw new Error("Not signed in");
  return data.user.id;
}

export async function createFamily(name: string): Promise<Family> {
  const uid = await myId();
  const { data: fam, error } = await supabase.from("families")
    .insert({ name, created_by: uid }).select().single();
  if (error) throw new Error(error.message);
  const { error: mErr } = await supabase.from("family_members")
    .insert({ family_id: fam.id, user_id: uid, role: "owner" });
  if (mErr) throw new Error(mErr.message);
  return fam as Family;
}

export async function joinByCode(code: string): Promise<Family> {
  const uid = await myId();
  const { data: fam, error } = await supabase.from("families")
    .select("*").eq("invite_code", code).single();
  if (error || !fam) throw new Error("Invalid invite code");
  const { error: mErr } = await supabase.from("family_members")
    .insert({ family_id: fam.id, user_id: uid, role: "member" });
  if (mErr && !mErr.message.includes("duplicate")) throw new Error(mErr.message);
  return fam as Family;
}

export async function listMyFamilies(): Promise<Family[]> {
  const { data: memberships, error } = await supabase.from("family_members").select("family_id");
  if (error) throw new Error(error.message);
  const ids = (memberships ?? []).map((m: any) => m.family_id);
  if (ids.length === 0) return [];
  const { data, error: fErr } = await supabase.from("families").select("*").in("id", ids);
  if (fErr) throw new Error(fErr.message);
  return (data ?? []) as Family[];
}

export async function rotateInviteCode(familyId: string): Promise<string> {
  const code = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
  const { error } = await supabase.from("families").update({ invite_code: code }).eq("id", familyId);
  if (error) throw new Error(error.message);
  return code;
}

export async function leaveFamily(familyId: string): Promise<void> {
  const uid = await myId();
  const { error } = await supabase.from("family_members")
    .delete().eq("family_id", familyId).eq("user_id", uid);
  if (error) throw new Error(error.message);
}
