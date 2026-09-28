// @vitest-environment node
import { describe, it, expect, beforeAll } from "vitest";
import { admin, makeUser, anonClient } from "./helpers";

// The comment leak below is real and was confirmed red before 0021 existed: a stranger and an
// anonymous visitor could both read a family's conversation about a published recipe.
//
// The recipe_tags tests are REGRESSION PINS, not proof of a new fix. 0003's rtags_write did
// guard writes with a read predicate, but 0005_join_rpc_and_tag_fix.sql already replaced it
// with an author-or-family-owner predicate. These tests were written expecting to fail and
// passed, which is how that was found. They stay because nothing else pins that policy, and
// because the obvious-looking "fix" (is_family_member) would LOOSEN it.
describe("public recipes do not over-share", () => {
  let owner: Awaited<ReturnType<typeof makeUser>>;
  let stranger: Awaited<ReturnType<typeof makeUser>>;
  let recipeId: string;
  let tagId: string;
  const anon = anonClient();

  beforeAll(async () => {
    owner = await makeUser(`owner-${Date.now()}@test.dev`);
    stranger = await makeUser(`stranger-${Date.now()}@test.dev`);
    // Two admin inserts, matching every existing integration test. There is no
    // create_family_with_owner RPC.
    const { data: family } = await admin.from("families")
      .insert({ name: "Owner Family", created_by: owner.id }).select().single();
    const familyId = family!.id;
    await admin.from("family_members")
      .insert({ family_id: familyId, user_id: owner.id, role: "owner" });

    const { data: recipe } = await owner.client.from("recipes")
      .insert({ family_id: familyId, author_id: owner.id, title: "Dal", visibility: "public" })
      .select("id").single();
    recipeId = recipe!.id;

    const { data: tag } = await owner.client.from("tags")
      .insert({ family_id: familyId, name: "everyday" }).select("id").single();
    tagId = tag!.id;
    await owner.client.from("recipe_tags").insert({ recipe_id: recipeId, tag_id: tagId });

    await owner.client.from("comments")
      .insert({ recipe_id: recipeId, author_id: owner.id, body: "Mum's version is saltier" });
  });

  it("does not leak family comments to a stranger", async () => {
    const { data } = await stranger.client.from("comments").select("body").eq("recipe_id", recipeId);
    expect(data).toEqual([]);
  });

  it("does not leak family comments to an anonymous visitor", async () => {
    const { data } = await anon.from("comments").select("body").eq("recipe_id", recipeId);
    expect(data).toEqual([]);
  });

  it("still lets the recipe's own family read its comments", async () => {
    const { data } = await owner.client.from("comments").select("body").eq("recipe_id", recipeId);
    expect(data).toHaveLength(1);
  });

  it("does not let a stranger delete a public recipe's tags", async () => {
    await stranger.client.from("recipe_tags").delete().eq("recipe_id", recipeId);
    // Read back as the owner: a refused DELETE under RLS is a silent zero-row no-op, not an
    // error, so the only honest assertion is that the row survived. (An INSERT, by contrast,
    // raises 42501.)
    const { data } = await owner.client.from("recipe_tags").select("tag_id").eq("recipe_id", recipeId);
    expect(data).toHaveLength(1);
  });

  it("does not let a stranger attach a tag to a public recipe", async () => {
    await stranger.client.from("recipe_tags").insert({ recipe_id: recipeId, tag_id: tagId });
    const { data } = await owner.client.from("recipe_tags").select("tag_id").eq("recipe_id", recipeId);
    expect(data).toHaveLength(1);
  });

  it("still lets the recipe's author tag it", async () => {
    const { error } = await owner.client.from("recipe_tags").delete().eq("recipe_id", recipeId);
    expect(error).toBeNull();
    const { data } = await owner.client.from("recipe_tags").select("tag_id").eq("recipe_id", recipeId);
    expect(data).toEqual([]);
  });
});
