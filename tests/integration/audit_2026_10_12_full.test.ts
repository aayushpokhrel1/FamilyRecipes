// @vitest-environment node
//
// The four findings of the full security audit on 2026-10-12, each attempted the way an
// attacker would attempt it, against a real database.
//
// Same rule as audit_2026_10_12.test.ts: every assertion is made as an ORDINARY SIGNED-IN
// USER or as an anonymous stranger, never through `admin`. The service-role client bypasses
// RLS and function grants entirely, so an assertion made through it passes however broken
// the control is. `admin` appears only to arrange the victim's data or to read back what was
// actually stored, never to prove that a refusal happened.
import { describe, it, expect, beforeAll } from "vitest";
import { admin, makeUser, anonClient } from "./helpers";

const uniq = () => `${Date.now()}-${Math.random().toString(16).slice(2)}`;

describe("kitchen role gate: a NULL role must not pass", () => {
  let owner: Awaited<ReturnType<typeof makeUser>>;
  let outsider: Awaited<ReturnType<typeof makeUser>>;
  let cook: Awaited<ReturnType<typeof makeUser>>;
  let org: string;
  let site: string;
  let dish: string;
  let version: string;

  beforeAll(async () => {
    owner = await makeUser(`kowner-${uniq()}@local.dev`);
    outsider = await makeUser(`koutsider-${uniq()}@local.dev`);
    cook = await makeUser(`kcook-${uniq()}@local.dev`);

    const k = owner.client.schema("kitchen");
    const { data: o, error: oe } = await k.rpc("create_org", {
      p_name: "Victim Kitchen",
      p_display_name: "Victim Kitchen",
    });
    if (oe) throw oe;
    org = o as string;

    const { data: s, error: se } = await k.rpc("add_site", { p_org: org, p_name: "Main" });
    if (se) throw se;
    site = s as string;

    const { data: d, error: de } = await k.rpc("create_dish", { p_org: org, p_title: "Real Dish" });
    if (de) throw de;
    dish = d as string;

    const { data: v, error: ve } = await k.rpc("revise_dish", {
      p_dish: dish, p_note: "v1", p_ingredients: [], p_steps: [],
    });
    if (ve) throw ve;
    version = v as string;

    // A real employee on the lowest role, so the "while employed" comparison is honest.
    await admin.schema("kitchen").from("staff")
      .insert({ org_id: org, user_id: cook.id, role: "cook", display_name: "Cook" });
  });

  it("refuses a complete outsider at every step of the pipeline", async () => {
    // THE BUG: staff_role() returns NULL for a non-member, `NULL not in (...)` is NULL, and
    // plpgsql skips an IF body whose condition is NULL, so the raise never fired and the
    // function fell through into the privileged work.
    const k = outsider.client.schema("kitchen");

    const create = await k.rpc("create_dish", { p_org: org, p_title: "Attacker Dish" });
    expect(create.error, "create_dish must refuse a non-staff caller").not.toBeNull();

    const revise = await k.rpc("revise_dish", {
      p_dish: dish, p_note: "tampered", p_ingredients: [], p_steps: [],
    });
    expect(revise.error, "revise_dish must refuse a non-staff caller").not.toBeNull();

    const trial = await k.rpc("send_to_trial", { p_dish: dish, p_site: site });
    expect(trial.error, "send_to_trial must refuse a non-staff caller").not.toBeNull();

    const sign = await k.rpc("sign_off", { p_version: version });
    expect(sign.error, "sign_off must refuse a non-staff caller").not.toBeNull();

    // What actually matters: nothing of theirs landed in the victim's org.
    const { data: dishes } = await admin.schema("kitchen").from("dishes").select("title").eq("org_id", org);
    expect((dishes ?? []).map((r) => r.title)).toEqual(["Real Dish"]);
    const { data: approvals } = await admin.schema("kitchen").from("approvals").select("id").eq("version_id", version);
    expect(approvals ?? []).toEqual([]);
  });

  it("refuses an anonymous stranger too", async () => {
    const { error } = await anonClient().schema("kitchen")
      .rpc("create_dish", { p_org: org, p_title: "Anon Dish" });
    expect(error).not.toBeNull();
  });

  it("removing someone from staff must not INCREASE their authority", async () => {
    // The sharpest form of the bug. While employed on the lowest role the gate fired
    // correctly; once the staff row was deleted, staff_role() returned NULL and the same
    // person was allowed to sign dishes onto the live menu. Offboarding granted authority.
    const k = cook.client.schema("kitchen");

    const whileEmployed = await k.rpc("create_dish", { p_org: org, p_title: "By cook" });
    expect(whileEmployed.error, "a cook is not an owner or chef, so this must be refused")
      .not.toBeNull();

    await admin.schema("kitchen").from("staff").delete().eq("org_id", org).eq("user_id", cook.id);

    const afterLeaving = await k.rpc("create_dish", { p_org: org, p_title: "After leaving" });
    expect(afterLeaving.error, "a FORMER employee must be refused at least as firmly")
      .not.toBeNull();
  });

  it("still lets the real owner run the pipeline", async () => {
    // A fix that breaks the feature is not a fix.
    const k = owner.client.schema("kitchen");
    expect((await k.rpc("send_to_trial", { p_dish: dish, p_site: site })).error).toBeNull();
    expect((await k.rpc("sign_off", { p_version: version })).error).toBeNull();
    const { data } = await admin.schema("kitchen").from("dishes").select("stage").eq("id", dish).single();
    expect(data!.stage).toBe("menu");
  });
});

describe("account deletion erases the public identity", () => {
  // WHAT THIS CAN AND CANNOT CHECK, stated so nobody mistakes the scope.
  //
  // The fix itself is in supabase/functions/delete-account/index.ts, and the local edge
  // runtime does not come up in this project (the CLI reports it among "Stopped services"
  // on every start), so the function cannot be invoked here. Inventing a test that re-runs
  // the function's SQL by hand would assert nothing about the function.
  //
  // So the code is guarded statically by supabase/deletion_parity.test.ts, which fails if
  // the two deletion paths ever blank different column sets again, or if either leaves a
  // column that public_cooks exposes. That runs in `npm test` with no Docker.
  //
  // What IS checkable here is the database invariant that migration 0052 established and
  // that both paths must now preserve: a profile whose login is gone carries no public
  // identity. If a future change reintroduces one, this goes red.
  it("holds the invariant that a profile with no login has no public identity", async () => {
    // Read it through the view, as a stranger would, then confirm each listed cook still
    // has a login. public_cooks is exactly the surface the finding was about.
    const { data: cooks } = await anonClient().from("public_cooks").select("id, handle");
    const ids = (cooks ?? []).map((c) => c.id);
    if (ids.length === 0) return;

    const { data: users } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    const live = new Set((users?.users ?? []).map((u) => u.id));
    const orphans = (cooks ?? []).filter((c) => !live.has(c.id)).map((c) => c.handle);
    expect(orphans, "these cooks are publicly listed but their account is gone").toEqual([]);
  });

  it("a cook with a handle is listed, so the check above is not vacuous", async () => {
    // Guard the guard: if nothing is ever listed, the invariant passes for the wrong reason.
    const cook = await makeUser(`listed-${uniq()}@local.dev`);
    const handle = `kept${Date.now().toString().slice(-8)}`;
    const { error } = await cook.client.from("profiles")
      .update({ handle, public_name: "Still Here", bio: "A bio" }).eq("id", cook.id);
    expect(error).toBeNull();

    const { data } = await anonClient().from("public_cooks").select("handle").eq("handle", handle);
    expect(data).toHaveLength(1);
  });
});

describe("a published dish cannot be rewritten outside the approval pipeline", () => {
  let publisher: Awaited<ReturnType<typeof makeUser>>;
  let recipeId: string;
  let venueFamily: string;

  beforeAll(async () => {
    publisher = await makeUser(`pub-${uniq()}@local.dev`);
    const k = publisher.client.schema("kitchen");
    const { data: org } = await k.rpc("create_org", { p_name: "Pub Co", p_display_name: "Pub Co" });
    const { data: site } = await k.rpc("add_site", { p_org: org, p_name: "S" });
    const { data: dish } = await k.rpc("create_dish", { p_org: org, p_title: "Published Dish" });
    const { data: version } = await k.rpc("revise_dish", {
      p_dish: dish, p_note: "v1",
      p_ingredients: [{ position: 1, item: "flour", quantity: "200", unit: "g" }],
      p_steps: [{ position: 1, text: "Mix it" }],
    });
    await k.rpc("send_to_trial", { p_dish: dish, p_site: site });
    await k.rpc("sign_off", { p_version: version });
    const { error: pubErr } = await k.rpc("publish_dish", { p_version: version });
    if (pubErr) throw pubErr;

    const { data: snap } = await admin.schema("kitchen").from("published_snapshots")
      .select("recipe_id, venue_family_id").eq("dish_id", dish).single();
    recipeId = snap!.recipe_id;
    venueFamily = snap!.venue_family_id;
  });

  it("the publisher cannot join the venue family", async () => {
    // 0047 asserted this was impossible "BY CONSTRUCTION". It was not: every family gets a
    // default invite_code and families_member_read lets the row's creator read it.
    const { data: fam } = await publisher.client.from("families")
      .select("invite_code").eq("id", venueFamily).maybeSingle();

    if (fam?.invite_code) {
      const { error } = await publisher.client.rpc("join_family_by_code", { p_code: fam.invite_code });
      expect(error, "joining a venue family must be refused").not.toBeNull();
    }

    const { data: members } = await admin.from("family_members").select("user_id").eq("family_id", venueFamily);
    expect(members ?? [], "a venue family must have no members, ever").toEqual([]);
  });

  it("the publisher cannot rewrite the published ingredients or steps", async () => {
    await publisher.client.from("recipe_ingredients").update({ item: "POISON" }).eq("recipe_id", recipeId);
    await publisher.client.from("recipe_steps").update({ text: "POISON STEP" }).eq("recipe_id", recipeId);

    const { data: ings } = await admin.from("recipe_ingredients").select("item").eq("recipe_id", recipeId);
    const { data: steps } = await admin.from("recipe_steps").select("text").eq("recipe_id", recipeId);
    expect((ings ?? []).map((r) => r.item)).toEqual(["flour"]);
    expect((steps ?? []).map((r) => r.text)).toEqual(["Mix it"]);
  });

  it("the publisher cannot delete the published recipe out from under the snapshot", async () => {
    await publisher.client.from("recipes").delete().eq("id", recipeId);
    const { data } = await admin.from("recipes").select("id").eq("id", recipeId);
    expect(data, "deleting the published recipe would cascade the snapshot away").toHaveLength(1);
  });
});

describe("the fixes did not break the ordinary family paths", () => {
  it("an author can still write and edit their own recipe's children", async () => {
    // 0050 added a destination-membership requirement to five policies. If that is too
    // strict, ordinary cooking breaks, which is worse than the low-severity hole it closed.
    const user = await makeUser(`fam-${uniq()}@local.dev`);
    const { data: fam, error: fe } = await user.client.rpc("create_family", { p_name: "Fam" });
    expect(fe).toBeNull();

    const { data: rec, error: re } = await user.client.from("recipes")
      .insert({ family_id: fam.id, author_id: user.id, title: "Mine", visibility: "private" })
      .select("id").single();
    expect(re).toBeNull();

    expect((await user.client.from("recipe_ingredients")
      .insert({ recipe_id: rec!.id, position: 1, item: "salt" })).error).toBeNull();
    expect((await user.client.from("recipe_steps")
      .insert({ recipe_id: rec!.id, position: 1, text: "Add salt" })).error).toBeNull();
    expect((await user.client.from("recipe_ingredients")
      .update({ item: "pepper" }).eq("recipe_id", rec!.id)).error).toBeNull();
    expect((await user.client.from("recipes").delete().eq("id", rec!.id)).error).toBeNull();

    const { data: gone } = await admin.from("recipes").select("id").eq("id", rec!.id);
    expect(gone).toEqual([]);
  });

  it("joining a real family by code still works", async () => {
    const owner = await makeUser(`jown-${uniq()}@local.dev`);
    const joiner = await makeUser(`jjoin-${uniq()}@local.dev`);
    const { data: fam } = await owner.client.rpc("create_family", { p_name: "Joinable" });
    const { data: row } = await owner.client.from("families").select("invite_code").eq("id", fam.id).single();

    const { error } = await joiner.client.rpc("join_family_by_code", { p_code: row!.invite_code });
    expect(error, "0051 must only refuse VENUE families").toBeNull();

    const { data: members } = await admin.from("family_members")
      .select("user_id").eq("family_id", fam.id).eq("user_id", joiner.id);
    expect(members).toHaveLength(1);
  });
});
