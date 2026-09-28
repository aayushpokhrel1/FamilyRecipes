import { describe, it, expect, beforeAll } from "vitest";
import { admin, makeUser, anonClient } from "./helpers";

describe("public identity", () => {
  let cookId: string;
  let familyId: string;
  let publicRecipeId: string;
  const anon = anonClient();
  // Unique per run. handle is UNIQUE, so a hardcoded one passes on a fresh database and then
  // silently fails the update on every rerun, leaving handle null and failing the byline test
  // for a reason that has nothing to do with the byline.
  const handle = `cook${Date.now()}`;

  beforeAll(async () => {
    const cook = await makeUser(`cook-${Date.now()}@test.dev`);
    cookId = cook.id;
    // Families are made with the admin client and two inserts, which is how every existing
    // integration test does it. There is no create_family_with_owner RPC; the only family
    // RPC is join_family_by_code.
    const { data: family } = await admin.from("families")
      .insert({ name: "Pokhrel", created_by: cookId }).select().single();
    familyId = family!.id;
    await admin.from("family_members")
      .insert({ family_id: familyId, user_id: cookId, role: "owner" });
    const { data: recipe } = await cook.client.from("recipes")
      .insert({ family_id: familyId, author_id: cookId, title: "Momo", visibility: "public" })
      .select("id").single();
    publicRecipeId = (recipe as { id: string }).id;
    await admin.from("profiles")
      .update({ handle, public_name: "Aayush", bio: "Cooks momo." })
      .eq("id", cookId);
  });

  it("lets a stranger read a published cook from the view", async () => {
    const { data } = await anon.from("public_cooks").select("handle,public_name,bio")
      .eq("handle", handle).single();
    expect(data).toMatchObject({ handle, public_name: "Aayush" });
  });

  it("never lets a stranger read profiles directly", async () => {
    // display_name and preferences must not be reachable. RLS gives anon no policy on
    // profiles at all, so this is an empty result rather than an error.
    const { data } = await anon.from("profiles").select("id,display_name").eq("id", cookId);
    expect(data).toEqual([]);
  });

  it("hides cooks who have not claimed a handle", async () => {
    const quiet = await makeUser(`quiet-${Date.now()}@test.dev`);
    const { data } = await anon.from("public_cooks").select("id").eq("id", quiet.id);
    expect(data).toEqual([]);
  });

  it("gives a stranger the byline for a public recipe", async () => {
    const { data } = await anon.from("public_recipe_bylines")
      .select("handle,public_name,family_name").eq("recipe_id", publicRecipeId).single();
    expect(data).toMatchObject({ public_name: "Aayush", family_name: "Pokhrel" });
  });

  it("never lets a stranger read families directly", async () => {
    const { data } = await anon.from("families").select("name").eq("id", familyId);
    expect(data).toEqual([]);
  });
  it("lets a stranger read the avatar object of a published cook only", async () => {
    // The Worker signs avatars with the ANON key, by design: it holds no service key, so a
    // path the anon role cannot select is a path the Worker cannot serve.
    await admin.storage.from("avatars").upload(`${cookId}/a.png`, new Blob(["x"]));
    const { data, error } = await anon.storage.from("avatars")
      .createSignedUrl(`${cookId}/a.png`, 60);
    expect(error).toBeNull();
    expect(data?.signedUrl).toContain("token");
  });

  it("does not let a stranger read the avatar of a cook with no handle", async () => {
    const quiet = await makeUser(`quiet-av-${Date.now()}@test.dev`);
    await admin.storage.from("avatars").upload(`${quiet.id}/a.png`, new Blob(["x"]));
    const { error } = await anon.storage.from("avatars")
      .createSignedUrl(`${quiet.id}/a.png`, 60);
    expect(error).not.toBeNull();
  });
});
