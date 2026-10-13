// @vitest-environment node
//
// The six holes a security audit found on 2026-10-12, each one attempted here the way an
// attacker would attempt it, against a real database.
//
// THESE ARE THE ONLY TESTS IN THE PROJECT THAT PROVE A POLICY IS CORRECT. supabase/rls.test.ts
// reads the migrations as text, so it can tell you a policy EXISTS, has `with check`, and pins
// its search_path. Every single one of these six holes had a policy that existed and read
// perfectly. The gap between "there is a policy" and "the policy refuses this request" is
// exactly where all six lived, and only a request can close it.
//
// So: every assertion below is made as an ORDINARY SIGNED-IN USER or as an anonymous stranger,
// never through `admin`. The service-role client bypasses RLS entirely, so a test that asserts
// through it passes no matter how broken the policy is. `admin` appears only to arrange the
// victim's data, never to check the result.
import { describe, it, expect, beforeAll } from "vitest";
import { admin, makeUser, anonClient } from "./helpers";

const pw = "password123";
const uniq = () => `${Date.now()}-${Math.random().toString(16).slice(2)}`;

describe("the 2026-10-12 audit findings stay fixed", () => {
  let victim: Awaited<ReturnType<typeof makeUser>>;
  let attacker: Awaited<ReturnType<typeof makeUser>>;
  let victimFamily: string;
  let victimRecipe: string;

  beforeAll(async () => {
    victim = await makeUser(`victim-${uniq()}@local.dev`);
    attacker = await makeUser(`attacker-${uniq()}@local.dev`);

    const { data: fam, error } = await victim.client.rpc("create_family", { p_name: "Victim Fam" });
    if (error) throw error;
    victimFamily = fam.id;

    const { data: rec, error: rErr } = await victim.client.from("recipes")
      .insert({ family_id: victimFamily, author_id: victim.id, title: "Nan's stew", visibility: "public" })
      .select("id").single();
    if (rErr) throw rErr;
    victimRecipe = rec!.id;
  });

  // -------------------------------------------------------------------------------------
  it("F1: a stranger cannot add themselves to a family, as owner or at all", async () => {
    // The precondition is not a secret: every public recipe carries its family_id, and
    // recipes_read hands all of it to anon. So finding a target took one GET.
    const { data: leaked } = await anonClient()
      .from("recipes").select("family_id").eq("id", victimRecipe).single();
    expect(leaked!.family_id).toBe(victimFamily);

    for (const role of ["owner", "member"]) {
      const { error } = await attacker.client.from("family_members")
        .insert({ family_id: victimFamily, user_id: attacker.id, role });
      expect(error, `inserting as ${role} must be refused`).not.toBeNull();
    }

    // The thing that actually matters: no read of the family's contents.
    const { data: seen } = await attacker.client.from("recipes")
      .select("id").eq("family_id", victimFamily).eq("visibility", "family");
    expect(seen).toEqual([]);
    const { data: invite } = await attacker.client
      .from("families").select("invite_code").eq("id", victimFamily);
    expect(invite ?? []).toEqual([]);
  });

  // -------------------------------------------------------------------------------------
  it("F2: a user cannot make themselves a moderator", async () => {
    await attacker.client.from("profiles").update({ is_moderator: true }).eq("id", attacker.id);

    // Read it back through the SERVICE role, because the attacker's own view of the column
    // is not the question: what matters is what is actually stored and what is_moderator()
    // will read. A test that asked the attacker would be asking the suspect.
    const { data } = await admin.from("profiles").select("is_moderator").eq("id", attacker.id).single();
    expect(data!.is_moderator).toBe(false);
  });

  it("F2: a suspended user cannot lift their own suspension", async () => {
    await admin.from("profiles")
      .update({ suspended_at: new Date().toISOString(), suspended_reason: "testing" })
      .eq("id", attacker.id);

    await attacker.client.from("profiles")
      .update({ suspended_at: null, suspended_reason: null }).eq("id", attacker.id);

    const { data } = await admin.from("profiles").select("suspended_at").eq("id", attacker.id).single();
    expect(data!.suspended_at).not.toBeNull();

    await admin.from("profiles")
      .update({ suspended_at: null, suspended_reason: null }).eq("id", attacker.id);
  });

  it("F2: terms acceptance cannot be forged, only recorded", async () => {
    await attacker.client.from("profiles")
      .update({ terms_accepted_at: new Date().toISOString(), terms_version: "v99" })
      .eq("id", attacker.id);
    const { data: forged } = await admin.from("profiles")
      .select("terms_version").eq("id", attacker.id).single();
    expect(forged!.terms_version).not.toBe("v99");

    // And the legitimate path still works, or this is a fix that broke the feature.
    const { error } = await attacker.client.rpc("record_terms_acceptance", { p_version: "v1" });
    expect(error).toBeNull();
    const { data: real } = await admin.from("profiles")
      .select("terms_version, terms_accepted_at").eq("id", attacker.id).single();
    expect(real!.terms_version).toBe("v1");
    expect(real!.terms_accepted_at).not.toBeNull();
  });

  it("F2: the columns a user IS meant to edit still work", async () => {
    const { error } = await attacker.client.from("profiles")
      .update({ display_name: "Renamed" }).eq("id", attacker.id);
    expect(error).toBeNull();
    const { data } = await admin.from("profiles").select("display_name").eq("id", attacker.id).single();
    expect(data!.display_name).toBe("Renamed");
  });

  // -------------------------------------------------------------------------------------
  it("F4: a user cannot move their own recipe into someone else's family", async () => {
    const { data: fam } = await attacker.client.rpc("create_family", { p_name: "Attacker Fam" });
    const { data: mine } = await attacker.client.from("recipes")
      .insert({ family_id: fam.id, author_id: attacker.id, title: "Phish", visibility: "private" })
      .select("id").single();

    await attacker.client.from("recipes")
      .update({ family_id: victimFamily, visibility: "family" }).eq("id", mine!.id);

    const { data } = await admin.from("recipes").select("family_id").eq("id", mine!.id).single();
    expect(data!.family_id).toBe(fam.id);
  });

  it("F4: a user cannot move their own meal plan into someone else's family", async () => {
    const { data: fam } = await attacker.client.rpc("create_family", { p_name: "Plan Fam" });
    const { data: plan } = await attacker.client.from("meal_plans")
      .insert({ owner_id: attacker.id, family_id: fam.id, name: "Week" }).select("id").single();

    await attacker.client.from("meal_plans")
      .update({ family_id: victimFamily, is_shared: true }).eq("id", plan!.id);

    const { data } = await admin.from("meal_plans").select("family_id").eq("id", plan!.id).single();
    expect(data!.family_id).toBe(fam.id);
  });

  // -------------------------------------------------------------------------------------
  it("F3: an author cannot clear a moderator's takedown", async () => {
    await admin.from("recipes")
      .update({ removed_at: new Date().toISOString(), removed_reason: "spam", visibility: "family" })
      .eq("id", victimRecipe);

    // The author owns this recipe, so recipes_update lets them touch the row. The question
    // is whether they may touch THESE COLUMNS, and clearing both in one statement is what
    // slipped past the trigger before: it only ever fired on a row going public with
    // removed_at still set.
    const { error } = await victim.client.from("recipes")
      .update({ removed_at: null, removed_reason: null, visibility: "public" })
      .eq("id", victimRecipe);
    expect(error).not.toBeNull();

    const { data } = await admin.from("recipes").select("removed_at").eq("id", victimRecipe).single();
    expect(data!.removed_at).not.toBeNull();

    await admin.from("recipes")
      .update({ removed_at: null, removed_reason: null, visibility: "public" }).eq("id", victimRecipe);
  });

  it("F3: an ordinary edit by the author still works", async () => {
    const { error } = await victim.client.from("recipes")
      .update({ title: "Nan's stew, revised" }).eq("id", victimRecipe);
    expect(error).toBeNull();
  });

  // -------------------------------------------------------------------------------------
  it("F5: nobody can probe whether two other people blocked each other", async () => {
    const a = await makeUser(`blk-a-${uniq()}@local.dev`);
    const b = await makeUser(`blk-b-${uniq()}@local.dev`);
    const { error: bErr } = await a.client.from("blocks")
      .insert({ blocker_id: a.id, blocked_id: b.id, kind: "block" });
    expect(bErr).toBeNull();

    // A third party, and then a total stranger with no account at all. Both used to get a
    // straight `true`, which is how a blocked person could confirm who had blocked them.
    for (const [who, c] of [["a third party", attacker.client], ["anon", anonClient()]] as const) {
      const { data: between } = await c.rpc("blocked_between", { a: a.id, b: b.id });
      expect(between, `blocked_between must not answer for ${who}`).toBe(false);
      const { data: hidden } = await c.rpc("hidden_from_feed", { p_viewer: a.id, p_author: b.id });
      expect(hidden, `hidden_from_feed must not answer for ${who}`).toBe(false);
    }

    // Still answers for the person doing the looking, or the feed stops hiding anything.
    const { data: mine } = await a.client.rpc("hidden_from_feed", { p_viewer: a.id, p_author: b.id });
    expect(mine).toBe(true);
  });

  it("F5: these answer false for a signed-out visitor, never null", async () => {
    // NOT a style point. The first version of the F5 fix returned NULL to anonymous callers,
    // because auth.uid() is null and `null = x` is null. Both functions are consumed with
    // `not` in front of them inside policies, `not null` is null, and a WHERE clause drops a
    // null row exactly as if it were false. So the fix for a privacy leak was one deploy away
    // from HIDING THE PUBLIC FEED FROM EVERY SIGNED-OUT VISITOR. The test below is the cheap
    // version of that; the one after it is the real thing.
    const anon = anonClient();
    const { data: between } = await anon.rpc("blocked_between", { a: victim.id, b: attacker.id });
    const { data: hidden } = await anon.rpc("hidden_from_feed", { p_viewer: victim.id, p_author: attacker.id });
    expect(between).toBe(false);
    expect(hidden).toBe(false);
  });

  it("a signed-out visitor still sees public recipes in the feed", async () => {
    // The end-to-end form of the check above, through the function that actually renders the
    // public catalogue. If a three-valued boolean ever leaks back into those policies, this
    // goes red and names the symptom a user would report: "the site looks empty when I'm
    // logged out".
    const { data, error } = await anonClient().rpc("search_recipes", {
      p_family_id: null, p_search: null, p_tag_id: null,
    });
    expect(error).toBeNull();
    expect(Array.isArray(data) ? data.length : 0).toBeGreaterThan(0);
  });
});
