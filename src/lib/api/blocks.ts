import { supabase } from "../supabaseClient";
import type { Block } from "./types";

// Mute or block a cook. The blocker is the signed-in user, never a caller-supplied id: the
// policy checks blocker_id = auth.uid(), so a forged one is refused anyway.
//
// An UPSERT on the primary key (blocker_id, blocked_id), not an insert: mute and block are
// one table with a kind, so changing a mute to a block is a single call. A plain insert
// would fail on the primary key the second time and every caller would have to know to
// delete first, which is exactly the delete-plus-insert this table exists to avoid.
export async function setBlock(cookId: string, kind: "mute" | "block"): Promise<void> {
  const { data } = await supabase.auth.getUser();
  if (!data.user) throw new Error("Not signed in");
  const { error } = await supabase.from("blocks").upsert({
    blocker_id: data.user.id,
    blocked_id: cookId,
    kind,
  });
  if (error) throw new Error(error.message);
}

// Lift a mute or a block. No blocker_id filter here on purpose: RLS already scopes every
// row to blocker_id = auth.uid(), so adding one would be a second copy of the same rule,
// and the copy is the one that drifts and then silently deletes nothing.
export async function removeBlock(cookId: string): Promise<void> {
  const { error } = await supabase.from("blocks").delete().eq("blocked_id", cookId);
  if (error) throw new Error(error.message);
}

// The viewer's own mutes and blocks, newest first. RLS is what scopes this to the caller:
// a block the other person can discover is not a block, so there is no filter to add here.
export async function listMyBlocks(): Promise<Block[]> {
  const { data, error } = await supabase
    .from("blocks")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as Block[];
}
