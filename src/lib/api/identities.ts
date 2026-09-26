import { supabase } from "../supabaseClient";
import type { UserIdentity } from "@supabase/supabase-js";

export type { UserIdentity };

export async function listIdentities(): Promise<UserIdentity[]> {
  const { data, error } = await supabase.auth.getUserIdentities();
  if (error) throw new Error(error.message);
  return data?.identities ?? [];
}

// Redirects to Google like signInWithGoogle, but attaches the result to the
// SIGNED-IN account rather than starting a new one. Needs manual linking enabled
// in the project's auth settings, or this fails at runtime.
export async function linkGoogle(): Promise<void> {
  const { error } = await supabase.auth.linkIdentity({ provider: "google" });
  if (error) throw new Error(error.message);
}

// Supabase refuses to remove the last identity, which is what stops someone
// locking themselves out. Callers must say so in words: a bare failure on a
// security screen reads as something being broken.
export async function unlinkIdentity(identity: UserIdentity): Promise<void> {
  const { error } = await supabase.auth.unlinkIdentity(identity);
  if (error) throw new Error(error.message);
}

export const hasProvider = (identities: UserIdentity[], provider: string) =>
  identities.some((i) => i.provider === provider);
