import { supabase } from "../supabaseClient";

export async function signUp(email: string, password: string, displayName: string) {
  const { data, error } = await supabase.auth.signUp({
    email, password, options: { data: { display_name: displayName } },
  });
  if (error) throw new Error(error.message);
  // With email confirmation ON, Supabase returns a user but no session until the link is
  // clicked. The caller decides between "you're in" and "go check your inbox".
  return { user: data.user, session: data.session };
}
export async function signIn(email: string, password: string) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw new Error(error.message);
  return data.user!;
}
export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw new Error(error.message);
}
export async function getSession() {
  const { data } = await supabase.auth.getSession();
  return data.session;
}
export function onAuthChange(cb: (userId: string | null) => void) {
  return supabase.auth.onAuthStateChange((_e, session) => cb(session?.user.id ?? null));
}
