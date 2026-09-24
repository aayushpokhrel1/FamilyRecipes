import { supabase } from "../supabaseClient";

export async function deleteAccount(): Promise<void> {
  const { data, error } = await supabase.functions.invoke("delete-account", { body: {} });
  if (error) throw new Error(error.message);
  // The function reports failures in the body with a 500, which supabase-js does not
  // always surface as an invoke error, so check the payload too.
  if (data?.error) throw new Error(data.error);
  await supabase.auth.signOut();
}
