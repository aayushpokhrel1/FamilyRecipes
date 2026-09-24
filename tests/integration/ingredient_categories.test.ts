// @vitest-environment node
// Covers migration 0013: a family's aisle tags are theirs alone, and tagging
// the same ingredient twice corrects it rather than duplicating it.
import { expect, test } from "vitest";
import { admin, makeUser } from "./helpers";

async function familyWith(prefix: string) {
  const user = await makeUser(`${prefix}${Date.now()}@t.dev`);
  const { data: fam } = await admin.from("families")
    .insert({ name: prefix, created_by: user.id }).select().single();
  await admin.from("family_members")
    .insert({ family_id: fam!.id, user_id: user.id, role: "owner" });
  return { user, family: fam! };
}

test("a family's aisle tags are invisible to everyone else", async () => {
  const { user, family } = await familyWith("cat");
  const { error } = await user.client.from("ingredient_categories")
    .insert({ family_id: family.id, key: "besan", category: "Pantry & Grains" });
  expect(error).toBeNull();

  const outsider = await makeUser(`catout${Date.now()}@t.dev`);
  const { data: visible } = await outsider.client.from("ingredient_categories").select("id");
  expect(visible).toEqual([]);

  const { error: denied } = await outsider.client.from("ingredient_categories")
    .insert({ family_id: family.id, key: "atta", category: "Baking" });
  expect(denied).not.toBeNull();
});

test("re-tagging an ingredient corrects it instead of adding a second row", async () => {
  const { user, family } = await familyWith("catup");
  await user.client.from("ingredient_categories")
    .insert({ family_id: family.id, key: "gochujang", category: "Baking" });

  const { error } = await user.client.from("ingredient_categories")
    .upsert({ family_id: family.id, key: "gochujang", category: "Condiments & Sauces" },
            { onConflict: "family_id,key" });
  expect(error).toBeNull();

  const { data } = await admin.from("ingredient_categories")
    .select("category").eq("family_id", family.id).eq("key", "gochujang");
  expect(data).toHaveLength(1);
  expect(data![0].category).toBe("Condiments & Sauces");
});

test("two families can disagree about the same ingredient", async () => {
  const a = await familyWith("cata");
  const b = await familyWith("catb");
  await a.user.client.from("ingredient_categories")
    .insert({ family_id: a.family.id, key: "coconut milk", category: "Pantry & Grains" });
  await b.user.client.from("ingredient_categories")
    .insert({ family_id: b.family.id, key: "coconut milk", category: "Dairy & Eggs" });

  const { data: seenByA } = await a.user.client.from("ingredient_categories").select("category");
  expect(seenByA).toEqual([{ category: "Pantry & Grains" }]);
});
