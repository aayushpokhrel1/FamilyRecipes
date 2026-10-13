// @vitest-environment node
// 0056. THE EXPLOIT, run as the anonymous caller against a real database, through the same
// PostgREST a browser talks to.
//
// A VIEW HAS NO ROW-LEVEL SECURITY. `public_cooks` (0020) reads `profiles`, which is covered
// by `profiles_self_read`, and the view exists to get PAST that policy so a stranger can read
// a published cook's name. It is not `security_invoker`, so every statement through it ran as
// the view's owner, with the table's RLS switched off, and the view is auto-updatable because
// it selects from one table. Supabase's default privileges for role postgres in schema public
// then granted ALL on it to anon, so the live ACL was `anon=arwdDxtm` while the migration
// said only `grant select`. Anyone holding the publishable key, which ships in the JS bundle
// on purpose, could rewrite or delete any published cook's row.
//
// This cannot be a static check: the dangerous privilege appears in no migration. It cannot be
// asserted through `admin` either, which is the usual rule here with an extra edge, since the
// service role is one of the roles that is SUPPOSED to be able to write.
import { describe, it, expect } from "vitest";
import { admin, anonClient, makeUser } from "./helpers";

const rand = () =>
  Array.from({ length: 8 }, () => String.fromCharCode(97 + Math.floor(Math.random() * 26))).join("");

// A cook with a handle is a PUBLISHED cook: `handle is not null` is what every public view of
// a cook is gated on, and it is what puts the row inside this view at all.
async function publishedCook() {
  const cook = await makeUser(`pcw-${rand()}@t.dev`);
  const handle = `h${rand()}`;
  await admin.from("profiles")
    .update({ handle, public_name: "Real Name", bio: "real bio" }).eq("id", cook.id);
  return { cook, handle };
}

describe("a stranger cannot write through public_cooks", () => {
  it("refuses an anonymous update, and the cook's identity is untouched", async () => {
    const { cook, handle } = await publishedCook();

    const { error } = await anonClient()
      .from("public_cooks")
      .update({ public_name: "VIA REST", bio: "from the anon key" })
      .eq("handle", handle);
    expect(error).not.toBeNull();

    const { data: after } = await admin.from("profiles")
      .select("handle, public_name, bio").eq("id", cook.id).single();
    expect(after).toEqual({ handle, public_name: "Real Name", bio: "real bio" });
  }, 30000);

  // The handle is the identity in every /cooks/<handle> URL, and clearing it IS unpublishing,
  // so nulling someone else's was both a defacement and a way to break every link to them.
  // Asserted separately from the update above because it is the version of the attack that
  // needs no plausible replacement value.
  it("refuses an anonymous attempt to clear someone's handle", async () => {
    const { cook, handle } = await publishedCook();

    const { error } = await anonClient()
      .from("public_cooks").update({ handle: null }).eq("handle", handle);
    expect(error).not.toBeNull();

    const { data: after } = await admin.from("profiles")
      .select("handle").eq("id", cook.id).single();
    expect(after!.handle).toBe(handle);
  }, 30000);

  it("refuses an anonymous delete, which used to remove the profile row outright", async () => {
    // A cook who has written anything is refused by a NO ACTION foreign key
    // (recipes.author_id, comments.author_id, families.created_by and three more), so this
    // uses the case that really was deleted: a cook who set a handle and nothing else.
    const { cook, handle } = await publishedCook();

    const { error } = await anonClient().from("public_cooks").delete().eq("handle", handle);
    expect(error).not.toBeNull();

    const { count } = await admin.from("profiles")
      .select("id", { count: "exact", head: true }).eq("id", cook.id);
    expect(count).toBe(1);
  }, 30000);

  it("refuses an anonymous insert", async () => {
    const { error } = await anonClient()
      .from("public_cooks")
      .insert({ id: "00000000-0000-0000-0000-000000000000", handle: `h${rand()}` });
    expect(error).not.toBeNull();
  }, 30000);

  // A SIGNED-IN cook is not privileged here either: the grant was to anon AND authenticated,
  // so any account could have taken another cook's handle by clearing it first and then
  // setting their own to the freed value.
  it("refuses a signed-in cook writing to someone else's row", async () => {
    const { cook, handle } = await publishedCook();
    const other = await makeUser(`pcw-other-${rand()}@t.dev`);

    const { error } = await other.client
      .from("public_cooks").update({ public_name: "mine now" }).eq("handle", handle);
    expect(error).not.toBeNull();

    const { data: after } = await admin.from("profiles")
      .select("public_name").eq("id", cook.id).single();
    expect(after!.public_name).toBe("Real Name");
  }, 30000);

  // The view must still do its job, or the revoke could pass by having broken the feature:
  // reading another cook's published identity is the only reason this view exists.
  it("still lets a stranger READ a published cook, which is what the view is for", async () => {
    const { handle } = await publishedCook();
    const { data, error } = await anonClient()
      .from("public_cooks").select("handle, public_name").eq("handle", handle).single();
    expect(error).toBeNull();
    expect(data).toEqual({ handle, public_name: "Real Name" });
  }, 30000);

  // public_recipe_bylines joins three tables, so Postgres refuses to write through it whatever
  // the grant says, and the grant was inert. Pinned anyway: the privilege was the loaded half,
  // and the day somebody simplifies that view or adds an INSTEAD OF trigger it is already
  // sitting there.
  it("refuses an anonymous write to public_recipe_bylines", async () => {
    const { error } = await anonClient()
      .from("public_recipe_bylines").update({ public_name: "x" }).eq("handle", "nobody");
    expect(error).not.toBeNull();
  }, 30000);
});
