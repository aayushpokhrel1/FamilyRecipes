// Supabase Edge Function: delete-account
//
// Deletes the caller's own account. This CANNOT be done from the browser: an
// anon-key client has no permission to remove an auth user, so the deletion
// needs the service-role key, which must never reach the frontend.
//
// What it deliberately does NOT do is take the family's recipes with it. A
// recipe is the thing a family vault exists to keep, and other members are
// relying on it. So the profile row stays as a durable authorship record with
// its personal data blanked, and the recipe keeps an author it can point at.
// Migration 0014 is what makes that possible: it dropped the profiles -> auth
// users foreign key, so removing the login no longer cascades the profile away.
//
// Deployed by Supabase only; not typechecked by the app's tsc.
import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...cors },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors });
  }
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  // Validate the caller's JWT, not just the presence of the header. The user id
  // comes from the VERIFIED token and never from the request body: taking it
  // from the body would let anyone delete anyone.
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "unauthorized" }, 401);

  const caller = createClient(
    Deno.env.get("SUPABASE_URL"),
    Deno.env.get("SUPABASE_ANON_KEY"),
    { global: { headers: { Authorization: authHeader } } },
  );
  const { data: { user }, error: authError } = await caller.auth.getUser();
  if (authError || !user) return json({ error: "unauthorized" }, 401);

  const admin = createClient(
    Deno.env.get("SUPABASE_URL"),
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  // Order matters. Blank the profile BEFORE removing the login, so that if the
  // function dies halfway the account still exists and can be retried. The
  // reverse order could leave a live name attached to a deleted login.
  const { error: blankError } = await admin.from("profiles").update({
    display_name: "A former member",
    avatar_url: null,
    preferences: {},
  }).eq("id", user.id);
  if (blankError) return json({ error: blankError.message }, 500);

  // Meal plans are personal, not family heritage: nobody else is cooking from
  // someone's own week. Recipes, comments and photos stay.
  const { error: planError } = await admin.from("meal_plans").delete().eq("owner_id", user.id);
  if (planError) return json({ error: planError.message }, 500);

  const { error: memberError } = await admin.from("family_members").delete().eq("user_id", user.id);
  if (memberError) return json({ error: memberError.message }, 500);

  const { error: deleteError } = await admin.auth.admin.deleteUser(user.id);
  if (deleteError) return json({ error: deleteError.message }, 500);

  return json({ ok: true }, 200);
});
