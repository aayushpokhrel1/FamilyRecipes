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
// A relative .ts specifier, which is how Deno imports a sibling and why `tsc -b` excludes this
// directory. The arithmetic lives there rather than here because nothing in this file can be
// imported by a test: supabase/functions/boots.test.ts can only parse it.
import { activeStaffCount, kitchenThroughput } from "./kitchenNumbers.ts";

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

    if (action === "insights") {
      // EVERY NUMBER BELOW IS A PAIR: `all`, and `others` meaning accounts that are not
      // moderators. The owner is currently most of the traffic, so a single total would mostly
      // report him back to himself. The moderator ids are fetched ONCE here and the `others`
      // half is derived by excluding them, rather than running every query twice.
      const { data: mods } = await admin.from("profiles").select("id").eq("is_moderator", true);
      const moderatorIds = new Set((mods ?? []).map((m) => (m as { id: string }).id));
      const pair = (ids: Iterable<string>): { all: number; others: number } => {
        const all = new Set(ids);
        let others = 0;
        for (const id of all) if (!moderatorIds.has(id)) others += 1;
        return { all: all.size, others };
      };

      // ponytail: reads every activity row and aggregates in memory, which is right while this
      // table is small and wrong once it is not. The upgrade path is a SQL view or an RPC doing
      // the grouping; it is deliberately not that yet, because a view is a migration and this
      // needs none, and the same choice is already made and explained for signupsByDay above.
      const { data: activityRows } = await admin
        .from("activity_days")
        .select("user_id, day, surface");

      // The window boundaries are computed the same way `stats` does it, and compared against
      // the `day` string, so no date filter is pushed into SQL.
      const day7 = new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10);
      const day30 = new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10);

      const daysByUser = new Map<string, Set<string>>();
      const active7 = new Set<string>();
      const active30 = new Set<string>();
      const surfaceUsers = new Map<string, Set<string>>();
      let since: string | null = null;
      for (const row of activityRows ?? []) {
        const { user_id: userId, day, surface } = row as {
          user_id: string; day: string; surface: string;
        };
        if (since === null || day < since) since = day;
        const days = daysByUser.get(userId) ?? new Set<string>();
        days.add(day);
        daysByUser.set(userId, days);
        if (day >= day7) active7.add(userId);
        if (day >= day30) {
          active30.add(userId);
          const users = surfaceUsers.get(surface) ?? new Set<string>();
          users.add(userId);
          surfaceUsers.set(surface, users);
        }
      }

      // People with activity rows on 2 or more DISTINCT days. Misses anyone who used the site
      // on a single day, which is most one-off visitors.
      const repeat = pair(
        [...daysByUser.entries()].filter(([, days]) => days.size >= 2).map(([id]) => id),
      );
      // People with any activity row in the last 7 days. Misses anyone who reads without
      // touching a tracked surface, and anyone whose only visit was longer ago.
      const active7Pair = pair(active7);
      // People with any activity row in the last 30 days. Same misses as active7, wider window.
      const active30Pair = pair(active30);

      // Count of profiles. NOT logins: a profile outlives its login on purpose, so this
      // includes every account ever deleted.
      const { data: profileRows } = await admin.from("profiles").select("id, signup_source");
      const signedUp = pair((profileRows ?? []).map((p) => (p as { id: string }).id));

      // Profiles with at least one family_members row. Misses anyone who never joined a family,
      // which includes every solo cook.
      const { data: memberRows } = await admin.from("family_members").select("user_id");
      const joinedFamily = pair(
        (memberRows ?? []).map((m) => (m as { user_id: string }).user_id),
      );

      // Profiles with at least one recipe (recipes.author_id). Misses anyone who only reads,
      // and anyone whose recipes were all deleted with their account.
      const { data: authorRows } = await admin.from("recipes").select("author_id");
      const savedRecipe = pair(
        (authorRows ?? []).map((r) => (r as { author_id: string }).author_id),
      );

      // Distinct people per surface over the last 30 days. Every surface appears, including the
      // ones with zero, so the panel's rows do not move around as data arrives. Sorted by the
      // `all` count, descending.
      const surfaces = [
        "recipes", "families", "potluck", "kitchen", "cupboard",
        "cookmode", "drafts", "settings", "profile", "moderation",
      ].map((surface) => {
        const p = pair(surfaceUsers.get(surface) ?? []);
        return { surface, all: p.all, others: p.others };
      });
      surfaces.sort((a, b) => b.all - a.all);

      // Counts of profiles grouped by signup_source. `null` in the data means "arrived without a
      // credited link", which includes everyone who signed up before this feature existed, so
      // the key here is the literal string "uncredited" and the client labels it that way. It
      // must NOT be called "direct": that would be a claim about how they arrived that the
      // column cannot support.
      //
      // The three known sources are seeded at zero, like the surface list above, so the panel
      // can distinguish "nobody has arrived through that page" from "the credit is not
      // working". Without them a run with no marketing signups shows ONLY "uncredited", which
      // reads identically to the feature being broken.
      const sourceIds = new Map<string, Set<string>>([
        ["hub", new Set<string>()],
        ["family", new Set<string>()],
        ["professional", new Set<string>()],
      ]);
      for (const row of profileRows ?? []) {
        const { id, signup_source: source } = row as {
          id: string; signup_source: string | null;
        };
        const key = source ?? "uncredited";
        const ids = sourceIds.get(key) ?? new Set<string>();
        ids.add(id);
        sourceIds.set(key, ids);
      }
      const sources = [...sourceIds.entries()].map(([source, ids]) => {
        const p = pair(ids);
        return { source, all: p.all, others: p.others };
      });

      return json(
        {
          returning: { repeat, active7: active7Pair, active30: active30Pair, since },
          funnel: { signedUp, joinedFamily, savedRecipe },
          surfaces,
          sources,
        },
        200,
      );
    }

    if (action === "kitchen_insights") {
      // THE ONE PLACE BOTH SCHEMAS MEET, and supabase/kitchen_seal.test.ts names this function so
      // that it stays the only one. This reads kitchen tables to COUNT them and nothing else: it
      // must never move data between the schemas, and must never hand a kitchen row to a family
      // user. The seal exists to stop the family app serving kitchen users; an operator counting
      // both of their own products is not that.
      //
      // THE KITCHEN APP HAS BEEN LIVE SINCE 2026-10-12, and the numbers here are still near
      // zero. The reason is not that it is unbuilt or undeployed: it is live `noindex` and
      // linked from nowhere, so it has no traffic BY DESIGN. That is a correct answer and not a
      // bug, and nothing below throws, returns null or invents a placeholder because a table is
      // empty. This comment claimed the app was not deployed until 2026-10-21, which is the
      // same contradiction PRODUCT.md carried until 2026-10-18.
      //
      // Like `insights`, this fetches rows and aggregates in TypeScript rather than in SQL, so it
      // needs no migration. Every query result is guarded with `(rows ?? [])`.
      const { data: orgRows } = await admin
        .schema("kitchen")
        .from("orgs")
        .select("id, created_at");
      const { data: siteRows } = await admin
        .schema("kitchen")
        .from("sites")
        .select("org_id");
      const { data: staffRows } = await admin
        .schema("kitchen")
        .from("staff")
        .select("user_id");
      const { data: dishRows } = await admin
        .schema("kitchen")
        .from("dishes")
        .select("id, org_id");
      const { data: snapshotRows } = await admin
        .schema("kitchen")
        .from("published_snapshots")
        .select("dish_id");
      const { data: inviteRows } = await admin
        .schema("kitchen")
        .from("staff_invites")
        .select("used_at");
      // The version id is in the select list because it is the only path from an approval to a
      // dish: kitchen.approvals is keyed by version_id (0042).
      const { data: versionRows } = await admin
        .schema("kitchen")
        .from("dish_versions")
        .select("id, dish_id, created_at");
      const { data: approvalRows } = await admin
        .schema("kitchen")
        .from("approvals")
        .select("version_id, approved_at");
      // ONLY user_id, AND IT IS ONLY EVER COUNTED. A named person's attendance is a kitchen
      // row, and this function must never hand a kitchen row to a family user, which is the
      // seal supabase/kitchen_seal.test.ts holds. An owner sees their own staff by name inside
      // the kitchen app, through kitchen.group_people (0065); the console never does, and
      // display_name must not appear in this select list.
      //
      // The last seven days, by LOCAL date, because kitchen.activity_days stores the client's
      // local date and comparing it against a UTC day would shift the window by one in any
      // UTC+ timezone.
      const weekAgo = new Date(Date.now() - 6 * 86400000);
      const activeSince = `${weekAgo.getFullYear()}-${String(weekAgo.getMonth() + 1).padStart(2, "0")}-${String(weekAgo.getDate()).padStart(2, "0")}`;
      const { data: activeRows } = await admin
        .schema("kitchen")
        .from("activity_days")
        .select("user_id")
        .gte("day", activeSince);

      // Rows in kitchen.orgs. Every org, including one whose owner never came back.
      const orgs = (orgRows ?? []).length;
      // Rows in kitchen.sites. A site is a venue, so an org with three venues counts three.
      const sites = (siteRows ?? []).length;
      // DISTINCT user_id across kitchen.staff. One person can hold a staff row in more than one
      // org, and counting rows would report them once per org, so this counts people.
      const staff = new Set(
        (staffRows ?? []).map((s) => (s as { user_id: string }).user_id),
      ).size;
      // Rows in kitchen.dishes, at every stage. A dish that was never published still counts.
      const dishes = (dishRows ?? []).length;
      // Rows in kitchen.published_snapshots, which is ONE ROW PER DISH: dish_id is that table's
      // primary key (0044), so re-publishing a dish updates its row rather than adding one.
      // This is therefore a count of dishes that are currently published, NOT a count of
      // publication events, and there is no way to count events from this table at all.
      const published = (snapshotRows ?? []).length;
      // Rows in kitchen.staff_invites with used_at null, meaning an invite that was created and
      // never redeemed. Misses nothing: an expired-but-unused invite is still open here, because
      // the table has no expiry column to read.
      const openInvites = (inviteRows ?? []).filter(
        (i) => (i as { used_at: string | null }).used_at === null,
      ).length;

      // The kitchen funnel, the same idea as the family one, and each number is a count of ORGS
      // rather than of rows. An org that did the thing twice counts once.
      const orgIdsWithSite = new Set(
        (siteRows ?? []).map((s) => (s as { org_id: string }).org_id),
      );
      const orgIdsWithDish = new Set(
        (dishRows ?? []).map((d) => (d as { org_id: string }).org_id),
      );
      // published_snapshots carries dish_id and not org_id, so the org is reached by mapping the
      // dish to its org. A snapshot whose dish is missing from dishRows is dropped rather than
      // guessed at, which is the only honest option when the join key is absent.
      const dishToOrg = new Map(
        (dishRows ?? []).map((d) => {
          const { id, org_id: orgId } = d as { id: string; org_id: string };
          return [id, orgId] as const;
        }),
      );
      const orgIdsWithPublished = new Set<string>();
      for (const row of snapshotRows ?? []) {
        const orgId = dishToOrg.get((row as { dish_id: string }).dish_id);
        if (orgId) orgIdsWithPublished.add(orgId);
      }

      // Orgs created per day over the last 30 days, "YYYY-MM-DD" -> count. Gaps are NOT filled:
      // the page fills them, and the same method and shape as `signupsByDay` in `stats` above.
      const since = new Date(Date.now() - 29 * 86400000).toISOString();
      const orgsByDay: Record<string, number> = {};
      for (const row of orgRows ?? []) {
        const createdAt = String((row as { created_at: string }).created_at);
        if (createdAt < since) continue;
        const day = createdAt.slice(0, 10);
        orgsByDay[day] = (orgsByDay[day] ?? 0) + 1;
      }

      // The newest org's created_at, or null when there are none. The page uses it to say how
      // new this all is, so null is the honest answer for an empty table rather than a date.
      let newest: string | null = null;
      for (const row of orgRows ?? []) {
        const createdAt = String((row as { created_at: string }).created_at);
        if (newest === null || createdAt > newest) newest = createdAt;
      }

      return json(
        {
          counts: { orgs, sites, staff, dishes, published, openInvites },
          // The same four questions a group's own owner is answered, over every group at once.
          // Both implementations read 0063 for their definitions, so a change to one of them
          // belongs in the other: a moderator and an owner looking at the same kitchen must
          // not be told two different stories.
          throughput: kitchenThroughput(
            (dishRows ?? []) as { id: string }[],
            (versionRows ?? []) as { id: string; dish_id: string; created_at: string }[],
            (approvalRows ?? []) as { version_id: string; approved_at: string }[],
          ),
          activeStaff: activeStaffCount((activeRows ?? []) as { user_id: string }[]),
          funnel: {
            created: orgs,
            addedSite: orgIdsWithSite.size,
            addedDish: orgIdsWithDish.size,
            publishedDish: orgIdsWithPublished.size,
          },
          orgsByDay,
          newest,
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
          preferences: {},
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


      // Personal, not family heritage, and the same reasoning that deletes meal plans above.
      // THEY WERE ALL LEFT BEHIND UNTIL 2026-10-13, for different reasons each worth stating:
      //
      //   - A DRAFT is a recipe the cook never finished or never published. `drafts_read` is
      //     `author_id = auth.uid()`, so once the login is gone NOBODY can ever read it again:
      //     it was retained for ever, serving nothing, which is the one combination a deletion
      //     request plainly rules out. More personal than a meal plan, and that is deleted.
      //   - FOLLOWS are a relationship, not a vault. Leaving them kept a deleted cook inside
      //     other people's follower lists and counts, re-appearing in any total that does not
      //     resolve each row through public_cooks. Both directions go: the ones they made and
      //     the ones pointing at them.
      //   - THE AVATAR FILE is not the avatar_url. Nulling the column above hides the picture;
      //     the object stayed in the bucket. The privacy page says the photo is erased, so
      //     until this existed that page was false. The bucket is private and the read policy
      //     is `is_published_cook(folder)`, which is false once the handle is null, so it was
      //     unreachable rather than exposed. Unreachable is not erased.
      //
      // What deliberately SURVIVES, so the next reader does not have to re-derive it: recipes,
      // comments, photos on recipes and cook-log entries, because those live inside a family's
      // vault and other members are relying on them; reports, appeals and moderation records,
      // because a pattern has to remain actionable; and blocks, which protect the recipes that
      // stay. `src/pages/Privacy.tsx` names all of it, and MUST be updated with this list.
      const { error: draftError } = await admin
        .from("recipe_drafts")
        .delete()
        .eq("author_id", targetId);
      if (draftError) return json({ error: draftError.message }, 500);

      const { error: followError } = await admin
        .from("follows")
        .delete()
        .or(`follower_id.eq.${targetId},cook_id.eq.${targetId}`);
      if (followError) return json({ error: followError.message }, 500);

      // Best effort, and deliberately not fatal: the storage object is unreachable the moment the
      // handle is null, so failing the whole deletion over a bucket error would leave a live
      // login attached to an account the person asked to be rid of. Errors are swallowed for
      // that reason and not because they do not matter.
      try {
        const { data: avatarFiles } = await admin.storage.from("avatars").list(targetId);
        if (avatarFiles?.length) {
          await admin.storage
            .from("avatars")
            .remove(avatarFiles.map((f: { name: string }) => `${targetId}/${f.name}`));
        }
      } catch {
        // see above
      }

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
