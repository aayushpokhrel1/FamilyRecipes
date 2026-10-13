// @vitest-environment node
// WHAT THE DATABASE ACTUALLY DOES WHEN A POLICY DECLINES A WRITE, asserted rather than
// assumed, because three separate bugs in this app have come from assuming it raises.
//
// It does not raise. A policy does not reject a row, it fails to match one, so an UPDATE or a
// DELETE that row-level security declines affects zero rows and returns success. supabase-js
// resolves with `error: null`, and every caller that checked only `error` carried on as though
// it had written something:
//
//   - `updateRecipe` returned cleanly and RecipeEdit said "Saved" (0058, f4d720b);
//   - the shared meal plan page offered Remove, the steppers and the pickers to a relative,
//     and each did nothing (c869926);
//   - the comment thread offered Delete on every comment in the family (this commit).
//
// Each of those tables has READ wider than WRITE, which is the shape to look for: it is what
// every sharing feature creates. These tests pin the database's behaviour so the client-side
// guards above cannot be "simplified" back out on the belief that an error would be raised.
//
// Asserted as the ordinary user, never through `admin`: the service role bypasses RLS, so an
// assertion made through it proves nothing about a policy.
import { describe, it, expect } from "vitest";
import { admin, makeUser } from "./helpers";

const rand = () =>
  Array.from({ length: 8 }, () => String.fromCharCode(97 + Math.floor(Math.random() * 26))).join("");

// An author with a family recipe, and a second cook who is a MEMBER of that family: they may
// read everything here and write none of it.
async function householdWithTwo(prefix: string) {
  const author = await makeUser(`${prefix}-a-${rand()}@t.dev`);
  const { data: fam } = await admin.from("families")
    .insert({ name: prefix, created_by: author.id }).select().single();
  await admin.from("family_members")
    .insert({ family_id: fam!.id, user_id: author.id, role: "owner" });
  const member = await makeUser(`${prefix}-m-${rand()}@t.dev`);
  await admin.from("family_members")
    .insert({ family_id: fam!.id, user_id: member.id, role: "member" });
  const { data: rec } = await admin.from("recipes")
    .insert({ family_id: fam!.id, author_id: author.id, title: `R${rand()}`, visibility: "family" })
    .select().single();
  return { author, member, fam: fam!, rec: rec! };
}

describe("a write refused by row-level security is not an error", () => {
  it("answers a refused DELETE on a comment with success and zero rows", async () => {
    const { author, member, rec } = await householdWithTwo("sr-comment");
    const { data: comment } = await author.client.from("comments")
      .insert({ recipe_id: rec.id, author_id: author.id, body: "theirs" }).select().single();

    // The member can READ it, which is why the thread showed them a Delete button.
    const { data: seen } = await member.client.from("comments").select("id").eq("id", comment!.id);
    expect(seen).toHaveLength(1);

    const { data, error } = await member.client.from("comments")
      .delete().eq("id", comment!.id).select("id");
    expect(error).toBeNull();
    expect(data).toEqual([]);

    const { data: still } = await admin.from("comments").select("id").eq("id", comment!.id);
    expect(still).toHaveLength(1);
  }, 30000);

  it("answers a refused DELETE on a recipe the same way", async () => {
    const { member, rec } = await householdWithTwo("sr-recipe");
    const { data, error } = await member.client.from("recipes")
      .delete().eq("id", rec.id).select("id");
    expect(error).toBeNull();
    expect(data).toEqual([]);
    const { data: still } = await admin.from("recipes").select("id").eq("id", rec.id);
    expect(still).toHaveLength(1);
  }, 30000);

  it("answers a refused write to another cook's shared meal plan the same way", async () => {
    const { author, member, fam } = await householdWithTwo("sr-plan");
    const { data: plan } = await admin.from("meal_plans")
      .insert({ owner_id: author.id, family_id: fam.id, name: "Theirs", is_shared: true })
      .select().single();
    const { data: item } = await admin.from("meal_plan_items")
      .insert({ plan_id: plan!.id, recipe_id: null, position: 0 }).select().maybeSingle();

    // The member really can read the plan: that is what "shared" means, and it is how the
    // plan reaches their list and the page offers them its controls.
    const { data: readable } = await member.client.from("meal_plans").select("id").eq("id", plan!.id);
    expect(readable).toHaveLength(1);

    const renamed = await member.client.from("meal_plans")
      .update({ name: "Mine now" }).eq("id", plan!.id).select("id");
    expect(renamed.error).toBeNull();
    expect(renamed.data).toEqual([]);

    if (item) {
      const removed = await member.client.from("meal_plan_items")
        .delete().eq("id", item.id).select("id");
      expect(removed.error).toBeNull();
      expect(removed.data).toEqual([]);
    }

    const { data: after } = await admin.from("meal_plans").select("name").eq("id", plan!.id).single();
    expect(after!.name).toBe("Theirs");
  }, 30000);

  it("still lets the owner do all three, so the policies are not simply shut", async () => {
    const { author, rec, fam } = await householdWithTwo("sr-ok");
    const { data: comment } = await author.client.from("comments")
      .insert({ recipe_id: rec.id, author_id: author.id, body: "mine" }).select().single();
    const gone = await author.client.from("comments").delete().eq("id", comment!.id).select("id");
    expect(gone.data).toHaveLength(1);

    const { data: plan } = await admin.from("meal_plans")
      .insert({ owner_id: author.id, family_id: fam.id, name: "Theirs", is_shared: true })
      .select().single();
    const renamed = await author.client.from("meal_plans")
      .update({ name: "Renamed" }).eq("id", plan!.id).select("id");
    expect(renamed.data).toHaveLength(1);

    const deleted = await author.client.from("recipes").delete().eq("id", rec.id).select("id");
    expect(deleted.data).toHaveLength(1);
  }, 30000);
});
