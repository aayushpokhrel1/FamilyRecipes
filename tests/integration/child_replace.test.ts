// @vitest-environment node
// Verifies the 0006 atomic-replace RPCs against a real Postgres: they replace
// (not append) child rows for the author, and RLS still blocks a non-member
// even though the writes go through a SECURITY INVOKER function.
import { expect, test } from "vitest";
import { admin, makeUser } from "./helpers";

async function famWithRecipe(prefix: string) {
  const alice = await makeUser(`${prefix}${Date.now()}@t.dev`);
  const { data: fam } = await admin.from("families")
    .insert({ name: prefix, created_by: alice.id }).select().single();
  await admin.from("family_members")
    .insert({ family_id: fam!.id, user_id: alice.id, role: "owner" });
  const { data: rec } = await admin.from("recipes").insert({
    family_id: fam!.id, author_id: alice.id, title: "T", visibility: "family",
  }).select().single();
  return { alice, fam: fam!, rec: rec! };
}

test("replace_recipe_children atomically replaces ingredients and steps for the author", async () => {
  const { alice, rec } = await famWithRecipe("rc");
  const { error } = await alice.client.rpc("replace_recipe_children", {
    p_recipe_id: rec.id,
    p_ingredients: [{ quantity: "1", unit: "cup", item: "rice" }, { quantity: "2", unit: null, item: "water" }],
    p_steps: [{ text: "Boil" }],
  });
  expect(error).toBeNull();

  const ing = await admin.from("recipe_ingredients")
    .select("position,item").eq("recipe_id", rec.id).order("position");
  expect(ing.data).toEqual([{ position: 0, item: "rice" }, { position: 1, item: "water" }]);
  const steps = await admin.from("recipe_steps")
    .select("position,text").eq("recipe_id", rec.id).order("position");
  expect(steps.data).toEqual([{ position: 0, text: "Boil" }]);

  // second call replaces rather than appends; null steps are left untouched
  await alice.client.rpc("replace_recipe_children", {
    p_recipe_id: rec.id, p_ingredients: [{ quantity: null, unit: null, item: "salt" }], p_steps: null,
  });
  const ing2 = await admin.from("recipe_ingredients")
    .select("position,item").eq("recipe_id", rec.id).order("position");
  expect(ing2.data).toEqual([{ position: 0, item: "salt" }]);
  const steps2 = await admin.from("recipe_steps").select("text").eq("recipe_id", rec.id);
  expect(steps2.data).toHaveLength(1);
});

test("a non-member cannot replace another recipe's children (RLS holds through the RPC)", async () => {
  const { rec } = await famWithRecipe("rc-owner");
  const bob = await makeUser(`rc-bob${Date.now()}@t.dev`);
  await admin.from("recipe_ingredients")
    .insert({ recipe_id: rec.id, position: 0, quantity: "1", unit: null, item: "original" });

  const { error } = await bob.client.rpc("replace_recipe_children", {
    p_recipe_id: rec.id, p_ingredients: [{ quantity: "9", unit: null, item: "hacked" }], p_steps: null,
  });
  expect(error).not.toBeNull(); // insert blocked by the ing_write with-check policy

  const ing = await admin.from("recipe_ingredients").select("item").eq("recipe_id", rec.id);
  expect(ing.data).toEqual([{ item: "original" }]);
});

test("set_recipe_tags replaces tags atomically for the author", async () => {
  const { alice, fam, rec } = await famWithRecipe("st");
  const { data: t1 } = await admin.from("tags").insert({ family_id: fam.id, name: "dinner" }).select().single();
  const { data: t2 } = await admin.from("tags").insert({ family_id: fam.id, name: "quick" }).select().single();

  const { error } = await alice.client.rpc("set_recipe_tags", {
    p_recipe_id: rec.id, p_tag_ids: [t1!.id, t2!.id],
  });
  expect(error).toBeNull();
  const tags = await admin.from("recipe_tags").select("tag_id").eq("recipe_id", rec.id);
  expect(tags.data).toHaveLength(2);

  await alice.client.rpc("set_recipe_tags", { p_recipe_id: rec.id, p_tag_ids: [t1!.id] });
  const tags2 = await admin.from("recipe_tags").select("tag_id").eq("recipe_id", rec.id);
  expect(tags2.data).toEqual([{ tag_id: t1!.id }]);
});
