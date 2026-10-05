// Supabase Edge Function: admin
//
// The moderator console's backend. Everything here needs the service-role key, so none of it
// can be done from the browser, which is the whole reason this function exists:
//
//   - emails and last-sign-in live in auth.users, which RLS does not expose at all;
//   - profiles_self_read deliberately hides every OTHER profile row, from moderators too, so
//     even a moderator's browser client cannot list users;
//   - suspending, promoting and deleting an account are all auth-admin or cross-row writes.
//
// SECURITY MODEL, and the one thing never to change here. The caller is identified from their
// VERIFIED JWT, never from the request body, and their moderator flag is read with THEIR OWN
// client, so RLS is what proves the claim. The service-role client is created only after that
// check passes and is never used to decide who the caller is. Taking a user id or an
// "isModerator" from the body would let anyone do all of this to anyone.
//
// Report-driven actions do NOT belong here. Those stay in the resolve_report RPC, which is
// still the only place a report changes state, so there is one audit trail rather than two.
// This function is for the direct controls that have no report behind them.
//
// Deployed by Supabase only; not typechecked by the app's tsc. See supabase/functions/
// boots.test.ts, which parses this file so a syntax error cannot ship silently.
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

// A moderator may not strip the site of its last moderator, and may not suspend, demote or
// delete themselves. Both are lockout guards: the first leaves nobody able to act at all, the
// second is almost always a misclick and is trivially recoverable only via the SQL console.
async function countModerators(admin: ReturnType<typeof createClient>): Promise<number> {
  const { count } = await admin
    .from("profiles")
    .select("id", { count: "exact", head: true })
    .eq("is_moderator", true);
  return count ?? 0;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors });
  }
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "unauthorized" }, 401);

  const caller = createClient(
    Deno.env.get("SUPABASE_URL"),
    Deno.env.get("SUPABASE_ANON_KEY"),
    { global: { headers: { Authorization: authHeader } } },
  );
  const { data: { user }, error: authError } = await caller.auth.getUser();
  if (authError || !user) return json({ error: "unauthorized" }, 401);

  // Read the flag with the CALLER's client, so profiles_self_read is what authorises this.
  // Reading it with the service-role client would work too, and would be the version that
  // quietly stops depending on RLS being correct. Keep it here.
  const { data: me } = await caller
    .from("profiles")
    .select("is_moderator")
    .eq("id", user.id)
    .single();
  // 404, not 403: a non-moderator should not be able to confirm this endpoint exists.
  if (!me?.is_moderator) return json({ error: "not found" }, 404);

  const admin = createClient(
    Deno.env.get("SUPABASE_URL"),
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "bad request" }, 400);
  }
  const action = typeof body.action === "string" ? body.action : "";
  const targetId = typeof body.userId === "string" ? body.userId : "";
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";

  const count = async (table: string, filter?: (q: unknown) => unknown) => {
    let q = admin.from(table).select("id", { count: "exact", head: true });
    if (filter) q = filter(q) as typeof q;
    const { count: n } = await q;
    return n ?? 0;
  };

  try {
    if (action === "stats") {
      // TWO DIFFERENT QUESTIONS, and conflating them is what this split exists to stop.
      //
      // `everJoined` counts profiles, and a profile deliberately OUTLIVES its login: 0014
      // dropped the foreign key to auth.users so a recipe keeps its author when the person
      // leaves. So the profiles count includes every account ever deleted, and it only ever
      // grows.
      //
      // `users` is what a moderator actually reads the word to mean: people who can sign in
      // right now. That lives in auth.users, which PostgREST does not expose, so it comes
      // from the auth admin API's own total. perPage: 1 because the ROWS are not wanted, only
      // the count, and asking for 100 of them to throw away would be the lazy-looking but
      // slower option.
      //
      // Before this split the tile said "Users" and showed the profiles count, which read as
      // 6 on a database with 3 logins and no way to tell why.
      const [users, recipes, published, removed, families, openReports, suspended, everJoined] =
        await Promise.all([
          admin.auth.admin.listUsers({ page: 1, perPage: 1 }).then((r) => r.data?.total ?? 0),
          count("recipes"),
          count("recipes", (q) => (q as { eq: (a: string, b: unknown) => unknown }).eq("visibility", "public")),
          count("recipes", (q) => (q as { not: (a: string, b: string, c: unknown) => unknown }).not("removed_at", "is", null)),
          count("families"),
          count("reports", (q) => (q as { eq: (a: string, b: unknown) => unknown }).eq("status", "open")),
          count("profiles", (q) => (q as { not: (a: string, b: string, c: unknown) => unknown }).not("suspended_at", "is", null)),
          count("profiles"),
        ]);

      // Signups per day for the last 30 days, computed here rather than in SQL so this needs
      // no migration. profiles.created_at is the signup moment.
      const since = new Date(Date.now() - 29 * 86400000).toISOString();
      const { data: recent } = await admin
        .from("profiles")
        .select("created_at")
        .gte("created_at", since);
      const byDay: Record<string, number> = {};
      for (const row of recent ?? []) {
        const day = String((row as { created_at: string }).created_at).slice(0, 10);
        byDay[day] = (byDay[day] ?? 0) + 1;
      }

      return json(
        {
          users, recipes, published, removed, families, openReports, suspended,
          everJoined, signupsByDay: byDay,
        },
        200,
      );
    }

    if (action === "users") {
      // listUsers is the ONLY route to an email: profiles does not carry one, by design.
      const page = typeof body.page === "number" && body.page > 0 ? body.page : 1;
      const { data: list, error } = await admin.auth.admin.listUsers({ page, perPage: 100 });
      if (error) return json({ error: error.message }, 500);

      const ids = list.users.map((u) => u.id);
      const { data: profiles } = await admin
        .from("profiles")
        .select("id, display_name, handle, is_moderator, suspended_at, suspended_reason, created_at")
        .in("id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]);
      const byId = new Map(
        (profiles ?? []).map((p) => [(p as { id: string }).id, p as Record<string, unknown>]),
      );

      // One grouped count rather than a query per user: a roster of 100 would otherwise be 100
      // round trips, which is the shape that quietly turns an admin page into a timeout.
      const { data: recipeRows } = await admin.from("recipes").select("author_id").in(
        "author_id",
        ids.length ? ids : ["00000000-0000-0000-0000-000000000000"],
      );
      const recipeCount = new Map<string, number>();
      for (const r of recipeRows ?? []) {
        const id = (r as { author_id: string }).author_id;
        recipeCount.set(id, (recipeCount.get(id) ?? 0) + 1);
      }

      const users = list.users.map((u) => {
        const p = byId.get(u.id) ?? {};
        return {
          id: u.id,
          email: u.email ?? null,
          emailConfirmed: Boolean(u.email_confirmed_at),
          lastSignInAt: u.last_sign_in_at ?? null,
          createdAt: u.created_at,
          provider: (u.app_metadata as { provider?: string } | undefined)?.provider ?? null,
          displayName: (p.display_name as string | undefined) ?? null,
          handle: (p.handle as string | undefined) ?? null,
          isModerator: Boolean(p.is_moderator),
          suspendedAt: (p.suspended_at as string | undefined) ?? null,
          suspendedReason: (p.suspended_reason as string | undefined) ?? null,
          recipes: recipeCount.get(u.id) ?? 0,
        };
      });
      return json({ users, page, hasMore: list.users.length === 100 }, 200);
    }

    // Everything below acts on another account, so they share the same two guards.
    if (
      action === "suspend" ||
      action === "unsuspend" ||
      action === "set_moderator" ||
      action === "delete_user"
    ) {
      if (!targetId) return json({ error: "userId is required" }, 400);
      if (targetId === user.id && action !== "unsuspend") {
        return json({ error: "you cannot do that to your own account" }, 400);
      }

      if (action === "suspend") {
        if (!reason) return json({ error: "a reason is required" }, 400);
        // Mirrors resolve_report's 'suspend': an account whose published recipes stay up is
        // not suspended in any sense a reader would recognise, so the recipes come down too.
        const { error: e1 } = await admin
          .from("profiles")
          .update({ suspended_at: new Date().toISOString(), suspended_reason: reason })
          .eq("id", targetId);
        if (e1) return json({ error: e1.message }, 500);
        const { error: e2 } = await admin
          .from("recipes")
          .update({ visibility: "family", removed_at: new Date().toISOString(), removed_reason: reason })
          .eq("author_id", targetId)
          .eq("visibility", "public");
        if (e2) return json({ error: e2.message }, 500);
        return json({ ok: true }, 200);
      }

      if (action === "unsuspend") {
        // Deliberately does NOT republish their recipes. Lifting a suspension restores the
        // ability to publish; deciding which removed recipes should go back up is the author's
        // call, and silently republishing something taken down for cause would be worse.
        const { error } = await admin
          .from("profiles")
          .update({ suspended_at: null, suspended_reason: null })
          .eq("id", targetId);
        if (error) return json({ error: error.message }, 500);
        return json({ ok: true }, 200);
      }

      if (action === "set_moderator") {
        const value = body.value === true;
        if (!value && (await countModerators(admin)) <= 1) {
          return json({ error: "that is the last moderator" }, 400);
        }
        const { error } = await admin
          .from("profiles")
          .update({ is_moderator: value })
          .eq("id", targetId);
        if (error) return json({ error: error.message }, 500);
        return json({ ok: true }, 200);
      }

      // delete_user. Same order and the same reasoning as the delete-account function: blank
      // the profile BEFORE removing the login, so a half-finished run leaves a recoverable
      // account rather than a live name attached to a deleted one. The profile row survives
      // because recipes point at it, which is what migration 0014 made possible.
      const { error: blankError } = await admin
        .from("profiles")
        .update({
          display_name: "A former member",
          avatar_url: null,
          handle: null,
          public_name: null,
          bio: null,
          is_moderator: false,
        })
        .eq("id", targetId);
      if (blankError) return json({ error: blankError.message }, 500);

      const { error: planError } = await admin.from("meal_plans").delete().eq("owner_id", targetId);
      if (planError) return json({ error: planError.message }, 500);
      const { error: memberError } = await admin
        .from("family_members")
        .delete()
        .eq("user_id", targetId);
      if (memberError) return json({ error: memberError.message }, 500);

      const { error: deleteError } = await admin.auth.admin.deleteUser(targetId);
      if (deleteError) return json({ error: deleteError.message }, 500);
      return json({ ok: true }, 200);
    }

    if (action === "takedown_recipe" || action === "restore_recipe") {
      const recipeId = typeof body.recipeId === "string" ? body.recipeId : "";
      if (!recipeId) return json({ error: "recipeId is required" }, 400);

      if (action === "takedown_recipe") {
        if (!reason) return json({ error: "a reason is required" }, 400);
        const { error } = await admin
          .from("recipes")
          .update({ visibility: "family", removed_at: new Date().toISOString(), removed_reason: reason })
          .eq("id", recipeId);
        if (error) return json({ error: error.message }, 500);
        return json({ ok: true }, 200);
      }

      // Restore clears the removal mark but leaves visibility alone, so the author chooses to
      // publish again. A moderator putting someone's recipe back in public without asking is
      // not a correction, it is a different mistake.
      const { error } = await admin
        .from("recipes")
        .update({ removed_at: null, removed_reason: null })
        .eq("id", recipeId);
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true }, 200);
    }

    return json({ error: "unknown action" }, 400);
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
