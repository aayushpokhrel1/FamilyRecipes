import { supabase } from "../../supabaseClient";

// The kitchen app's own acceptance record. It cannot call lib/api/profile.ts: the seal in
// supabase/kitchen_seal.test.ts allows src/kitchen to reach only auth and kitchen/*, and that
// restriction is the justification for the kitchen being a second app rather than a mode.
export type Acceptance = { version: string; accepted_at: string };

export async function getMyAcceptance(): Promise<Acceptance | null> {
  const { data } = await supabase.auth.getUser();
  if (!data.user) throw new Error("Not signed in");
  const { data: row, error } = await supabase
    .schema("kitchen")
    .from("terms_acceptance")
    .select("version,accepted_at")
    .eq("user_id", data.user.id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (row as Acceptance | null) ?? null;
}

export async function acceptKitchenTerms(version: string): Promise<void> {
  const { data } = await supabase.auth.getUser();
  if (!data.user) throw new Error("Not signed in");
  const { error } = await supabase
    .schema("kitchen")
    .from("terms_acceptance")
    .upsert({ user_id: data.user.id, version, accepted_at: new Date().toISOString() });
  if (error) throw new Error(error.message);
}