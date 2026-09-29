// @vitest-environment node
// The DB-level half of save and fork: the two guards that make a copy safe, and the
// trigger that notices the first edit. These are tested here rather than in a unit test
// because a constraint and a trigger only exist in Postgres.
import { expect, test } from "vitest";
import { admin, makeUser } from "./helpers";

const rand = () =>
  Array.from({ length: 8 }, () => String.fromCharCode(97 + Math.floor(Math.random() * 26))).join("");

async function famWithRecipe(prefix: string, visibility = "public") {
  const cook = await makeUser(`${prefix}-${rand()}@t.dev`);
  const { data: fam } = await admin.from("families")
    .insert({ name: prefix, created_by: cook.id }).select().single();
  await admin.from("family_members")
    .insert({ family_id: fam!.id, user_id: cook.id, role: "owner" });
  const { data: rec } = await admin.from("recipes")
    .insert({ family_id: fam!.id, author_id: cook.id, title: `Dal ${rand()}`, visibility })
    .select().single();
  return { cook, fam: fam!, rec: rec! };
}

test("a saved copy cannot be made public", async () => {
  const { fam, cook, rec } = await famWithRecipe("sv-pub");
  const { data: copy } = await admin.from("recipes")
    .insert({ family_id: fam.id, author_id: cook.id, title: "Copy", visibility: "family",
              source_recipe_id: rec.id })
    .select().single();
  const { error } = await admin.from("recipes")
    .update({ visibility: "public" }).eq("id", copy!.id);
  expect(error).not.toBeNull();
  expect(error!.message).toMatch(/saved_copies_are_not_publishable/);
});

test("the same recipe cannot be saved into one family twice", async () => {
  const { fam, cook, rec } = await famWithRecipe("sv-dup");
  const row = { family_id: fam.id, author_id: cook.id, title: "Copy",
                visibility: "family" as const, source_recipe_id: rec.id };
  const first = await admin.from("recipes").insert(row);
  expect(first.error).toBeNull();
  const second = await admin.from("recipes").insert(row);
  expect(second.error).not.toBeNull();
  expect(second.error!.message).toMatch(/recipes_one_copy_per_family/);
});

// An ingredient-only edit does NOT touch the recipes row (updateRecipe skips the row
// update when the patch has no recipe-level keys), so a trigger on recipes alone would
// miss the edit most likely to be someone's first: changing an amount.
test("editing only the ingredients marks the copy as adapted", async () => {
  const { fam, cook, rec } = await famWithRecipe("sv-adapt");
  const { data: copy } = await admin.from("recipes")
    .insert({ family_id: fam.id, author_id: cook.id, title: "Copy", visibility: "family",
              source_recipe_id: rec.id })
    .select().single();
  expect(copy!.adapted_at).toBeNull();

  await admin.from("recipe_ingredients")
    .insert({ recipe_id: copy!.id, position: 0, quantity: "1", unit: "cup", item: "flour" });

  const { data: after } = await admin.from("recipes")
    .select("adapted_at").eq("id", copy!.id).single();
  expect(after!.adapted_at).not.toBeNull();
});

// A recipe that is nobody's copy must never gain an adapted_at, or the quiet-credit
// rule would fire on recipes that were typed from scratch.
test("editing a recipe that is not a copy leaves adapted_at null", async () => {
  const { rec } = await famWithRecipe("sv-own");
  await admin.from("recipe_ingredients")
    .insert({ recipe_id: rec.id, position: 0, quantity: "1", unit: "cup", item: "flour" });
  const { data: after } = await admin.from("recipes")
    .select("adapted_at").eq("id", rec.id).single();
  expect(after!.adapted_at).toBeNull();
});