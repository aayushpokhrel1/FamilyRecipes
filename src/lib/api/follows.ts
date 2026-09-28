import { supabase } from "../supabaseClient";

// Following a cook. The follows table is readable only by the follower (RLS), so every read
// here is implicitly "mine" and there is no cook-side query to write: no follower list and no
// follower count exists anywhere by design.

async function myId(): Promise<string | null> {
  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? null;
}

// Reads return empty rather than throwing when signed out, because Potluck's Following filter
// asks this on render and a visitor is an ordinary state, not an error.
export async function listFollowedCookIds(): Promise<string[]> {
  const uid = await myId();
  if (!uid) return [];
  const { data, error } = await supabase.from("follows")
    .select("cook_id").eq("follower_id", uid);
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => (r as { cook_id: string }).cook_id);
}

export async function isFollowing(cookId: string): Promise<boolean> {
  const uid = await myId();
  if (!uid) return false;
  const { data, error } = await supabase.from("follows")
    .select("cook_id").eq("follower_id", uid).eq("cook_id", cookId).maybeSingle();
  if (error) throw new Error(error.message);
  return data !== null;
}

// Writes throw when signed out, matching profile.ts: an unauthenticated write is a bug in the
// caller, not a state to render.
export async function follow(cookId: string): Promise<void> {
  const uid = await myId();
  if (!uid) throw new Error("Not signed in");
  // follower_id is sent explicitly even though RLS enforces it: the row needs the value, and
  // the policy is the guard, not the source.
  const { error } = await supabase.from("follows")
    .insert({ follower_id: uid, cook_id: cookId });
  if (error) throw new Error(error.message);
}

export async function unfollow(cookId: string): Promise<void> {
  const uid = await myId();
  if (!uid) throw new Error("Not signed in");
  // Filtered on BOTH columns. follower_id alone would be a policy-shaped assumption rather
  // than a correct query, and cook_id alone would delete other people's rows if the policy
  // ever widened.
  const { error } = await supabase.from("follows")
    .delete().eq("follower_id", uid).eq("cook_id", cookId);
  if (error) throw new Error(error.message);
}
