// @vitest-environment node
// Verifies the 0010 search_recipes RPC against a real Postgres: it finds recipes
// by title or ingredient using both trigram similarity (typo tolerance) and
// ilike substring matching, trims the term before matching, treats blank/null as
// "no search", honors the tag filter, and — being SECURITY INVOKER — still
// returns nothing to a non-member.
import { expect, test } from "vitest";
import { admin, makeUser } from "./helpers";

async function famWithRecipes(prefix: string) {
  const alice = await makeUser(`${prefix}${Date.now()}@t.dev`);
  const { data: fam } = await admin.from("families")
    .insert({ name: prefix, created_by: alice.id }).select().single();
  await admin.from("family_members")
    .insert({ family_id: fam!.id, user_id: alice.id, role: "owner" });

  // explicit created_at (oldest first) makes the created_at desc ordering deterministic
  const base = Date.now() - 3 * 60 * 60 * 1000;
  const at = (hours: number) => new Date(base + hours * 60 * 60 * 1000).toISOString();
  const { data: recipes } = await admin.from("recipes").insert([
    { family_id: fam!.id, author_id: alice.id, title: "Chicken Curry", visibility: "family", created_at: at(0) },
    { family_id: fam!.id, author_id: alice.id, title: "Tomato Soup", visibility: "family", created_at: at(1) },
    { family_id: fam!.id, author_id: alice.id, title: "Dal", visibility: "family", created_at: at(2) },
  ]).select();
  const byTitle = (title: string) => recipes!.find((r) => r.title === title)!;

  await admin.from("recipe_ingredients").insert([
    { recipe_id: byTitle("Tomato Soup").id, position: 0, quantity: "1", unit: "can", item: "crushed tomatoes" },
    { recipe_id: byTitle("Dal").id, position: 0, quantity: "1", unit: "cup", item: "red lentils" },
  ]);
  return { alice, fam: fam!, recipes: recipes! };
}

const titles = (data: any[] | null) => (data ?? []).map((r: any) => r.title);

test("search_recipes finds a recipe by exact title match", async () => {
  const { alice, fam } = await famWithRecipes("sr-title");
  const { data, error } = await alice.client.rpc("search_recipes", {
    p_family_id: fam.id, p_search: "chicken", p_tag_id: null,
  });
  expect(error).toBeNull();
  expect(titles(data)).toEqual(["Chicken Curry"]);
});

test("search_recipes finds a title with a typo (trigram similarity)", async () => {
  const { alice, fam } = await famWithRecipes("sr-typo-title");
  const { data, error } = await alice.client.rpc("search_recipes", {
    p_family_id: fam.id, p_search: "chiken", p_tag_id: null,
  });
  expect(error).toBeNull();
  expect(titles(data)).toEqual(["Chicken Curry"]);
});

test("search_recipes finds an ingredient with a typo", async () => {
  const { alice, fam } = await famWithRecipes("sr-typo-ing");
  const { data, error } = await alice.client.rpc("search_recipes", {
    p_family_id: fam.id, p_search: "tomatos", p_tag_id: null,
  });
  expect(error).toBeNull();
  expect(titles(data)).toEqual(["Tomato Soup"]);
});

test("search_recipes matches a short term by substring", async () => {
  const { alice, fam } = await famWithRecipes("sr-short");
  // "dal" is too short to clear the trigram similarity threshold, so this only
  // passes via the ilike arm.
  const { data, error } = await alice.client.rpc("search_recipes", {
    p_family_id: fam.id, p_search: "dal", p_tag_id: null,
  });
  expect(error).toBeNull();
  expect(titles(data)).toEqual(["Dal"]);
});

test("search_recipes matches an ingredient by exact item", async () => {
  const { alice, fam } = await famWithRecipes("sr-ing");
  const { data, error } = await alice.client.rpc("search_recipes", {
    p_family_id: fam.id, p_search: "lentils", p_tag_id: null,
  });
  expect(error).toBeNull();
  expect(titles(data)).toEqual(["Dal"]);
});

test("search_recipes trims surrounding whitespace before matching", async () => {
  const { alice, fam } = await famWithRecipes("sr-trim");
  // regression guard: the term is trimmed for the MATCHING too, not only for the
  // is-it-blank test, so a trailing space does not become ilike '%chicken %'.
  const { data, error } = await alice.client.rpc("search_recipes", {
    p_family_id: fam.id, p_search: "  chicken  ", p_tag_id: null,
  });
  expect(error).toBeNull();
  expect(titles(data)).toEqual(["Chicken Curry"]);
});

test("search_recipes treats blank, whitespace-only and null as no search", async () => {
  const { alice, fam } = await famWithRecipes("sr-blank");
  const all = ["Dal", "Tomato Soup", "Chicken Curry"];
  for (const term of ["", "   ", null]) {
    const { data, error } = await alice.client.rpc("search_recipes", {
      p_family_id: fam.id, p_search: term, p_tag_id: null,
    });
    expect(error).toBeNull();
    expect(titles(data)).toEqual(all);
  }
});

test("search_recipes returns nothing when nothing matches", async () => {
  const { alice, fam } = await famWithRecipes("sr-none");
  const { data, error } = await alice.client.rpc("search_recipes", {
    p_family_id: fam.id, p_search: "zzzzzz", p_tag_id: null,
  });
  expect(error).toBeNull();
  expect(titles(data)).toEqual([]);
});

test("search_recipes narrows results to the given tag", async () => {
  const { alice, fam, recipes } = await famWithRecipes("sr-tag");
  const { data: tag } = await admin.from("tags")
    .insert({ family_id: fam.id, name: "dinner" }).select().single();
  const dal = recipes.find((r) => r.title === "Dal")!;
  await admin.from("recipe_tags").insert({ recipe_id: dal.id, tag_id: tag!.id });

  const { data, error } = await alice.client.rpc("search_recipes", {
    p_family_id: fam.id, p_search: "", p_tag_id: tag!.id,
  });
  expect(error).toBeNull();
  expect(titles(data)).toEqual(["Dal"]);
});

test("a non-member gets no rows from search_recipes (RLS holds through the RPC)", async () => {
  const { fam } = await famWithRecipes("sr-owner");
  const bob = await makeUser(`sr-bob${Date.now()}@t.dev`);

  const { data, error } = await bob.client.rpc("search_recipes", {
    p_family_id: fam.id, p_search: "", p_tag_id: null,
  });
  // a select under RLS returns no rows rather than failing
  expect(error).toBeNull();
  expect(titles(data)).toEqual([]);
});
