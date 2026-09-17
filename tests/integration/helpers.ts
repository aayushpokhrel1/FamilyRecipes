import { createClient } from "@supabase/supabase-js";
// persistSession:false keeps each client's session in memory only. Without it,
// supabase-js shares one localStorage session, so signing in a user would make
// the service-role admin client start sending that user's JWT.
const noPersist = { auth: { autoRefreshToken: false, persistSession: false } };
export const admin = createClient(process.env.SB_URL!, process.env.SB_SERVICE_KEY!, noPersist);
// create a confirmed user and return a client authed as them
export async function makeUser(email: string) {
  const { data, error } = await admin.auth.admin.createUser({
    email, password: "password123", email_confirm: true,
  });
  if (error) throw error;
  const anon = createClient(process.env.SB_URL!, process.env.SB_ANON_KEY!, noPersist);
  await anon.auth.signInWithPassword({ email, password: "password123" });
  return { id: data.user!.id, client: anon };
}
