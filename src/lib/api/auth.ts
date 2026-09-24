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

// The re-auth below is NOT redundant, do not delete it. supabase.auth.updateUser({ password })
// does not ask for the current password, so without proving the caller knows it, anyone who
// finds an unlocked machine can silently take over the account.
export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  const { data } = await supabase.auth.getUser();
  const email = data.user?.email;
  if (!email) throw new Error("Not signed in");
  const { error: authError } = await supabase.auth.signInWithPassword({
    email, password: currentPassword,
  });
  if (authError) throw new Error("Current password is incorrect");
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) throw new Error(error.message);
}

export async function requestPasswordReset(email: string): Promise<void> {
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${window.location.origin}/recover`,
  });
  if (error) throw new Error(error.message);
}

// Recovery flow only: Supabase has already put a recovery session in place, so this
// must NOT re-authenticate the way changePassword does.
export async function setNewPassword(newPassword: string): Promise<void> {
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) throw new Error(error.message);
}
