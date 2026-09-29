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

// A saver is a stranger: a different user, in a different family, with no access to the
// source family at all. That is the case the whole feature exists for.
async function saver(prefix: string) {
  const user = await makeUser(`${prefix}-${rand()}@t.dev`);
  const { data: fam } = await admin.from("families")
    .insert({ name: prefix, created_by: user.id }).select().single();
  await admin.from("family_members")
    .insert({ family_id: fam!.id, user_id: user.id, role: "owner" });
  return { user, fam: fam! };
}

test("a stranger can save a public recipe, and the copy carries its children", async () => {
  const { rec } = await famWithRecipe("cp-src");
  // EVERY object in a PostgREST bulk insert must carry the SAME keys. PostgREST builds one
  // column list for the whole batch, so a key missing from one row is sent as NULL rather
  // than falling back to the column default, and `optional` is not null. Written the ragged
  // way this insert failed, the source recipe had no ingredients at all, and the copy test
  // then "failed" against a function that was working correctly. Always check .error here.
  const { error: ingErr } = await admin.from("recipe_ingredients").insert([
    { recipe_id: rec.id, position: 0, quantity: "2", unit: "cup", item: "flour",
      section: "Dough", optional: false },
    { recipe_id: rec.id, position: 1, quantity: "1", unit: "tsp", item: "salt",
      section: null, optional: false },
  ]);
  expect(ingErr).toBeNull();
  await admin.from("recipe_steps").insert({ recipe_id: rec.id, position: 0, text: "Mix" });

  const { user, fam } = await saver("cp-dst");
  const { data: newId, error } = await user.client.rpc("save_recipe_to_vault", {
    p_source: rec.id, p_family: fam.id,
  });
  expect(error).toBeNull();
  expect(newId).toBeTruthy();

  const { data: copy } = await admin.from("recipes").select("*").eq("id", newId).single();
  expect(copy!.family_id).toBe(fam.id);
  expect(copy!.author_id).toBe(user.id);
  expect(copy!.visibility).toBe("family");
  expect(copy!.source_recipe_id).toBe(rec.id);
  expect(copy!.adapted_at).toBeNull();

  const { data: ings } = await admin.from("recipe_ingredients")
    .select("*").eq("recipe_id", newId).order("position");
  expect(ings!.map((i: any) => i.item)).toEqual(["flour", "salt"]);
  // the section column proves the copy is not dropping columns it failed to name
  expect(ings![0].section).toBe("Dough");

  const { data: steps } = await admin.from("recipe_steps").select("*").eq("recipe_id", newId);
  expect(steps!.map((s: any) => s.text)).toEqual(["Mix"]);
});

test("a stranger cannot save a family or private recipe", async () => {
  for (const visibility of ["family", "private"]) {
    const { rec } = await famWithRecipe("cp-deny", visibility);
    const { user, fam } = await saver("cp-deny-dst");
    const { error } = await user.client.rpc("save_recipe_to_vault", {
      p_source: rec.id, p_family: fam.id,
    });
    expect(error, `visibility ${visibility} must not be savable`).not.toBeNull();
    // Asserting "some error happened" is not evidence: this test passed even when the RPC
    // did not exist yet, because a missing function is also an error. What actually matters
    // is that no copy was created, so assert that instead.
    const { data: copies } = await admin.from("recipes")
      .select("id").eq("family_id", fam.id).eq("source_recipe_id", rec.id);
    expect(copies, `visibility ${visibility} must leave no copy`).toEqual([]);
  }
  // Two visibilities, and each one creates a cook, a family, a recipe and a saver. That is
  // eight round trips against a cold container, which measured 5053ms against vitest's 5000ms
  // default and failed as a TIMEOUT that reads exactly like an assertion failure. CI is
  // slower than this machine, so the headroom is deliberate.
}, 30000);

// The whole reason a save copies instead of pointing: the original cook must not be able
// to empty someone else's vault.
test("deleting the original leaves the copy and its children intact", async () => {
  const { rec } = await famWithRecipe("cp-del");
  await admin.from("recipe_ingredients")
    .insert({ recipe_id: rec.id, position: 0, quantity: "1", unit: "cup", item: "rice" });
  const { user, fam } = await saver("cp-del-dst");
  const { data: newId } = await user.client.rpc("save_recipe_to_vault", {
    p_source: rec.id, p_family: fam.id,
  });

  await admin.from("recipes").delete().eq("id", rec.id);

  const { data: copy } = await admin.from("recipes")
    .select("source_recipe_id,source_cook_name").eq("id", newId).single();
  expect(copy).not.toBeNull();
  expect(copy!.source_recipe_id).toBeNull();      // FK cleared
  expect(copy!.source_cook_name).toBeTruthy();    // credit survives anyway
  const { data: ings } = await admin.from("recipe_ingredients")
    .select("item").eq("recipe_id", newId);
  expect(ings!.map((i: any) => i.item)).toEqual(["rice"]);
});

// Guards the no-fixed-column-list rule. replace_recipe_children has a fixed list and it has
// silently dropped a column twice (migrations 0009 and 0019 exist only because of it). If
// someone rewrites the copy to name columns, this test is what catches it.
test("a column added to recipe_ingredients is carried by the copy without touching the RPC",
  async () => {
    const { rec } = await famWithRecipe("cp-col");
    await admin.from("recipe_ingredients").insert({
      recipe_id: rec.id, position: 0, quantity: "1", unit: "cup", item: "oats",
      section: "Base", optional: true, alt_group: "g1",
    });
    const { user, fam } = await saver("cp-col-dst");
    const { data: newId } = await user.client.rpc("save_recipe_to_vault", {
      p_source: rec.id, p_family: fam.id,
    });
    const { data: ings } = await admin.from("recipe_ingredients")
      .select("*").eq("recipe_id", newId).single();
    // every column except the parent link must survive the copy
    expect(ings!.section).toBe("Base");
    expect(ings!.optional).toBe(true);
    expect(ings!.alt_group).toBe("g1");
  });