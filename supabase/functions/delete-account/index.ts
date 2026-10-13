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
  // MUST BLANK THE SAME COLUMNS AS admin/index.ts's delete_user. 0014's comment said this
  // flow leaves no identity, which was true when profiles had four columns. 0020 then added
  // handle, public_name and bio, only the moderator path was updated, and self-deleted cooks
  // stayed in public_cooks: /cooks/<handle> kept serving their name and bio and the sitemap
  // kept offering it to crawlers. supabase/deletion_parity.test.ts now fails if the two
  // paths drift apart again, or if either leaves a column public_cooks exposes.
  const { error: blankError } = await admin.from("profiles").update({
    display_name: "A former member",
    avatar_url: null,
    preferences: {},
    handle: null,
    public_name: null,
    bio: null,
  }).eq("id", user.id);
  if (blankError) return json({ error: blankError.message }, 500);

  // Meal plans are personal, not family heritage: nobody else is cooking from
  // someone's own week. Recipes, comments and photos stay.
  const { error: planError } = await admin.from("meal_plans").delete().eq("owner_id", user.id);
  if (planError) return json({ error: planError.message }, 500);

  const { error: memberError } = await admin.from("family_members").delete().eq("user_id", user.id);
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
    .eq("author_id", user.id);
  if (draftError) return json({ error: draftError.message }, 500);

  const { error: followError } = await admin
    .from("follows")
    .delete()
    .or(`follower_id.eq.${user.id},cook_id.eq.${user.id}`);
  if (followError) return json({ error: followError.message }, 500);

  // Best effort, and deliberately not fatal: the storage object is unreachable the moment the
  // handle is null, so failing the whole deletion over a bucket error would leave a live
  // login attached to an account the person asked to be rid of. Errors are swallowed for
  // that reason and not because they do not matter.
  try {
    const { data: avatarFiles } = await admin.storage.from("avatars").list(user.id);
    if (avatarFiles?.length) {
      await admin.storage
        .from("avatars")
        .remove(avatarFiles.map((f: { name: string }) => `${user.id}/${f.name}`));
    }
  } catch {
    // see above
  }

  const { error: deleteError } = await admin.auth.admin.deleteUser(user.id);
  if (deleteError) return json({ error: deleteError.message }, 500);

  return json({ ok: true }, 200);
});
