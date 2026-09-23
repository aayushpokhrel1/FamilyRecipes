// @vitest-environment node
// Verifies the 0011 servings column: it round-trips through setItemServings,
// defaults to null, and rejects a non-positive value at the database level.
import { expect, test } from "vitest";
import { admin, makeUser } from "./helpers";

async function planWithItem(prefix: string) {
  const alice = await makeUser(`${prefix}${Date.now()}@t.dev`);
  const { data: fam } = await admin.from("families")
    .insert({ name: prefix, created_by: alice.id }).select().single();
  await admin.from("family_members")
    .insert({ family_id: fam!.id, user_id: alice.id, role: "owner" });
  const { data: rec } = await admin.from("recipes")
    .insert({ family_id: fam!.id, author_id: alice.id, title: "T", visibility: "family" })
    .select().single();
  const { data: plan } = await admin.from("meal_plans")
    .insert({ name: "P", owner_id: alice.id, family_id: fam!.id }).select().single();
  const { data: item } = await admin.from("meal_plan_items")
    .insert({ plan_id: plan!.id, recipe_id: rec!.id }).select().single();
  return { alice, item: item! };
}

test("servings defaults to null and round-trips", async () => {
  const { alice, item } = await planWithItem("ps");
  expect(item.servings).toBeNull();

  const { error } = await alice.client.from("meal_plan_items")
    .update({ servings: 8 }).eq("id", item.id);
  expect(error).toBeNull();

  const { data } = await admin.from("meal_plan_items")
    .select("servings").eq("id", item.id).single();
  expect(data!.servings).toBe(8);
});

test("a non-positive servings value is rejected by the check constraint", async () => {
  const { alice, item } = await planWithItem("ps-zero");
  const { error } = await alice.client.from("meal_plan_items")
    .update({ servings: 0 }).eq("id", item.id);
  expect(error).not.toBeNull();
});
