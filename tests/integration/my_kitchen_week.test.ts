// @vitest-environment node
// Covers migration 0012: pantry_staples RLS, and duplicate_plan cloning items,
// shifting their days, and repointing leftovers at the clones.
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

test("staples are family-scoped and a non-member is denied", async () => {
  const { user, family } = await familyWith("staple");

  const { error: mine } = await user.client.from("pantry_staples")
    .insert({ family_id: family.id, key: "salt", label: "Salt" });
  expect(mine).toBeNull();

  const outsider = await makeUser(`outsider${Date.now()}@t.dev`);
  const { data: visible } = await outsider.client.from("pantry_staples").select("id");
  expect(visible).toEqual([]);

  const { error: denied } = await outsider.client.from("pantry_staples")
    .insert({ family_id: family.id, key: "pepper", label: "Pepper" });
  expect(denied).not.toBeNull();
});

test("the same staple cannot be added twice to one family", async () => {
  const { user, family } = await familyWith("dupstaple");
  await user.client.from("pantry_staples")
    .insert({ family_id: family.id, key: "olive oil", label: "Olive oil" });
  const { error } = await user.client.from("pantry_staples")
    .insert({ family_id: family.id, key: "olive oil", label: "Olive Oil" });
  expect(error).not.toBeNull();
});

test("duplicate_plan clones items, shifts days, and repoints leftovers", async () => {
  const { user, family } = await familyWith("dup");
  const { data: rec } = await admin.from("recipes")
    .insert({ family_id: family.id, author_id: user.id, title: "Adobo", visibility: "family", servings: 2 })
    .select().single();
  const { data: plan } = await admin.from("meal_plans")
    .insert({ name: "Week 1", owner_id: user.id, family_id: family.id, start_date: "2026-09-21", length_days: 7 })
    .select().single();
  const { data: dinner } = await admin.from("meal_plan_items")
    .insert({ plan_id: plan!.id, recipe_id: rec!.id, day: "2026-09-22", meal_slot: "dinner", position: 0, servings: 4 })
    .select().single();
  const { data: lunch } = await admin.from("meal_plan_items")
    .insert({ plan_id: plan!.id, recipe_id: rec!.id, day: "2026-09-23", meal_slot: "lunch", position: 1, leftover_of: dinner!.id })
    .select().single();
  expect(lunch!.leftover_of).toBe(dinner!.id);

  const { data: newId, error } = await user.client
    .rpc("duplicate_plan", { p_id: plan!.id, p_start: "2026-09-28" });
  expect(error).toBeNull();

  const { data: items } = await admin.from("meal_plan_items")
    .select("id,day,meal_slot,servings,leftover_of").eq("plan_id", newId).order("position");
  expect(items).toHaveLength(2);

  // every dated row moved by the same seven days
  const cloneDinner = items!.find((i) => i.meal_slot === "dinner")!;
  const cloneLunch = items!.find((i) => i.meal_slot === "lunch")!;
  expect(cloneDinner.day).toBe("2026-09-29");
  expect(cloneLunch.day).toBe("2026-09-30");
  expect(cloneDinner.servings).toBe(4);

  // the leftover follows its own clone, never the original plan's row
  expect(cloneLunch.leftover_of).toBe(cloneDinner.id);
  expect(cloneLunch.leftover_of).not.toBe(dinner!.id);
});

test("duplicating a plan you cannot read clones nothing", async () => {
  const { family, user } = await familyWith("private");
  const { data: plan } = await admin.from("meal_plans")
    .insert({ name: "Private", owner_id: user.id, family_id: family.id, start_date: "2026-09-21" })
    .select().single();

  const outsider = await makeUser(`nosy${Date.now()}@t.dev`);
  const { error } = await outsider.client
    .rpc("duplicate_plan", { p_id: plan!.id, p_start: "2026-09-28" });
  expect(error).not.toBeNull();
});
