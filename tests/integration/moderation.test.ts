// @vitest-environment node
// The DB half of moderation: who may read reports, who may act, and the two publish rules.
// These live in Postgres, so they are tested against a real one.
import { expect, test } from "vitest";
import { admin, makeUser } from "./helpers";

const rand = () =>
  Array.from({ length: 8 }, () => String.fromCharCode(97 + Math.floor(Math.random() * 26))).join("");

async function cookWithPublicRecipe(prefix: string) {
  const cook = await makeUser(`${prefix}-${rand()}@t.dev`);
  const { data: fam } = await admin.from("families")
    .insert({ name: prefix, created_by: cook.id }).select().single();
  await admin.from("family_members")
    .insert({ family_id: fam!.id, user_id: cook.id, role: "owner" });
  const { data: rec } = await admin.from("recipes")
    .insert({ family_id: fam!.id, author_id: cook.id, title: `R${rand()}`, visibility: "public" })
    .select().single();
  return { cook, fam: fam!, rec: rec! };
}

// A COOK REPORT NEEDS A PUBLISHED COOK, and since 0055 the database says so: report_insert
// requires is_published_cook(cook_id). That is not an extra hurdle invented by the policy, it
// is what the rest of the app already means by published, the same function the avatars read
// policy (0022) uses, and `handle is not null` is what every public view of a cook is gated
// on. The report-cook button lives on /cooks/:handle and nowhere else, so a cook with no
// handle cannot be reported because there is no page on which to have done anything.
//
// Two tests here used to report a cook straight out of cookWithPublicRecipe, which never set
// a handle. They passed against a policy that checked only the reporter, and the cook they
// reported was one the UI could not have shown them.
async function publish(cookId: string) {
  await admin.from("profiles")
    .update({ handle: `h${rand()}`, public_name: "Ada" }).eq("id", cookId);
}

async function moderator(prefix: string) {
  const m = await makeUser(`${prefix}-mod-${rand()}@t.dev`);
  await admin.from("profiles").update({ is_moderator: true }).eq("id", m.id);
  return m;
}

test("a signed-in user can report a public recipe, but only once while it is open", async () => {
  const { rec } = await cookWithPublicRecipe("md-rep");
  const reporter = await makeUser(`md-rep-${rand()}@t.dev`);
  const row = { recipe_id: rec.id, reporter_id: reporter.id, reason: "not_a_recipe" };
  const first = await reporter.client.from("reports").insert(row);
  expect(first.error).toBeNull();
  const second = await reporter.client.from("reports").insert(row);
  expect(second.error).not.toBeNull();
  expect(second.error!.message).toMatch(/reports_one_open_per_reporter/);
});

test("a non-moderator cannot read anyone else's reports", async () => {
  const { rec } = await cookWithPublicRecipe("md-read");
  const reporter = await makeUser(`md-read-a-${rand()}@t.dev`);
  await reporter.client.from("reports")
    .insert({ recipe_id: rec.id, reporter_id: reporter.id, reason: "offensive" });
  const nosy = await makeUser(`md-read-b-${rand()}@t.dev`);
  const { data } = await nosy.client.from("reports").select("id");
  expect(data).toEqual([]);
  // but a reporter can still see their own, which is what the "Reported" state reads
  const { data: mine } = await reporter.client.from("reports").select("id");
  expect(mine!.length).toBe(1);
});

test("a non-moderator cannot resolve a report", async () => {
  const { rec } = await cookWithPublicRecipe("md-deny");
  const reporter = await makeUser(`md-deny-${rand()}@t.dev`);
  const { data: rep } = await reporter.client.from("reports")
    .insert({ recipe_id: rec.id, reporter_id: reporter.id, reason: "offensive" })
    .select().single();
  const { error } = await reporter.client.rpc("resolve_report", {
    p_report_id: rep!.id, p_action: "unpublish", p_reason: "offensive",
  });
  expect(error).not.toBeNull();
  const { data: after } = await admin.from("recipes")
    .select("visibility,removed_at").eq("id", rec.id).single();
  expect(after!.visibility).toBe("public");
  expect(after!.removed_at).toBeNull();
});

test("a moderator can take a recipe down, and the author is told why", async () => {
  const { rec } = await cookWithPublicRecipe("md-down");
  const reporter = await makeUser(`md-down-r-${rand()}@t.dev`);
  const { data: rep } = await reporter.client.from("reports")
    .insert({ recipe_id: rec.id, reporter_id: reporter.id, reason: "not_a_recipe" })
    .select().single();
  const mod = await moderator("md-down");
  const { error } = await mod.client.rpc("resolve_report", {
    p_report_id: rep!.id, p_action: "unpublish", p_reason: "not_a_recipe",
  });
  expect(error).toBeNull();
  const { data: after } = await admin.from("recipes")
    .select("visibility,removed_at,removed_reason").eq("id", rec.id).single();
  expect(after!.visibility).toBe("family");
  expect(after!.removed_at).not.toBeNull();
  expect(after!.removed_reason).toBe("not_a_recipe");
  const { data: r2 } = await admin.from("reports").select("status").eq("id", rep!.id).single();
  expect(r2!.status).toBe("actioned");
}, 30000);

// Without this rule a takedown means nothing: the author flips it straight back.
test("the author cannot re-publish a recipe that was taken down", async () => {
  const { cook, rec } = await cookWithPublicRecipe("md-back");
  await admin.from("recipes")
    .update({ visibility: "family", removed_at: new Date().toISOString(),
              removed_reason: "offensive" }).eq("id", rec.id);
  const { error } = await cook.client.from("recipes")
    .update({ visibility: "public" }).eq("id", rec.id);
  expect(error).not.toBeNull();
  const { data: after } = await admin.from("recipes")
    .select("visibility").eq("id", rec.id).single();
  expect(after!.visibility).toBe("family");
});

test("clearing removed_at lets the recipe be published again", async () => {
  const { cook, rec } = await cookWithPublicRecipe("md-clear");
  await admin.from("recipes")
    .update({ visibility: "family", removed_at: new Date().toISOString() }).eq("id", rec.id);
  await admin.from("recipes")
    .update({ removed_at: null, removed_reason: null }).eq("id", rec.id);
  const { error } = await cook.client.from("recipes")
    .update({ visibility: "public" }).eq("id", rec.id);
  expect(error).toBeNull();
});

test("a suspended cook cannot publish anything, new or existing", async () => {
  const { cook, fam, rec } = await cookWithPublicRecipe("md-susp");
  await admin.from("recipes").update({ visibility: "family" }).eq("id", rec.id);
  await admin.from("profiles")
    .update({ suspended_at: new Date().toISOString(), suspended_reason: "offensive" })
    .eq("id", cook.id);

  const existing = await cook.client.from("recipes")
    .update({ visibility: "public" }).eq("id", rec.id);
  expect(existing.error).not.toBeNull();

  const fresh = await cook.client.from("recipes")
    .insert({ family_id: fam.id, author_id: cook.id, title: "New", visibility: "public" });
  expect(fresh.error).not.toBeNull();
});

// Sub-project 3 promises the original cook cannot reach into your vault. A takedown is the
// case where that promise bites, so it is pinned here as well as in saved_recipes.test.ts.
test("taking a recipe down leaves copies of it untouched", async () => {
  const { rec } = await cookWithPublicRecipe("md-copy");
  await admin.from("recipe_ingredients").insert({
    recipe_id: rec.id, position: 0, quantity: "1", unit: "cup", item: "rice",
    section: null, optional: false,
  });
  const saver = await makeUser(`md-copy-s-${rand()}@t.dev`);
  const { data: sfam } = await admin.from("families")
    .insert({ name: "md-copy-s", created_by: saver.id }).select().single();
  await admin.from("family_members")
    .insert({ family_id: sfam!.id, user_id: saver.id, role: "owner" });
  const { data: copyId } = await saver.client.rpc("save_recipe_to_vault", {
    p_source: rec.id, p_family: sfam!.id,
  });

  const reporter = await makeUser(`md-copy-r-${rand()}@t.dev`);
  const { data: rep } = await reporter.client.from("reports")
    .insert({ recipe_id: rec.id, reporter_id: reporter.id, reason: "offensive" })
    .select().single();
  const mod = await moderator("md-copy");
  await mod.client.rpc("resolve_report", {
    p_report_id: rep!.id, p_action: "unpublish", p_reason: "offensive",
  });

  const { data: copy } = await admin.from("recipes").select("id").eq("id", copyId).single();
  expect(copy).not.toBeNull();
  const { data: ings } = await admin.from("recipe_ingredients")
    .select("item").eq("recipe_id", copyId);
  expect(ings!.map((i: any) => i.item)).toEqual(["rice"]);
}, 30000);

// 0030: a report may name a COOK instead of a recipe, and the remedy for a public name that
// pretends to be someone else.
test("a cook can be reported, and one reporter cannot flood cook reports", async () => {
  const { cook } = await cookWithPublicRecipe("cr-target");
  await publish(cook.id);
  const reporter = await makeUser(`cr-rep-${rand()}@t.dev`);
  const row = { cook_id: cook.id, reporter_id: reporter.id, reason: "impersonation" };
  const first = await reporter.client.from("reports").insert(row);
  expect(first.error).toBeNull();
  const second = await reporter.client.from("reports").insert(row);
  expect(second.error).not.toBeNull();
}, 30000);

// Exactly one target. A report naming both, or neither, is a bug in whatever wrote it.
test("a report must name exactly one target", async () => {
  const { cook, rec } = await cookWithPublicRecipe("cr-both");
  const reporter = await makeUser(`cr-both-r-${rand()}@t.dev`);
  const both = await reporter.client.from("reports")
    .insert({ recipe_id: rec.id, cook_id: cook.id, reporter_id: reporter.id, reason: "other" });
  expect(both.error).not.toBeNull();
  const neither = await reporter.client.from("reports")
    .insert({ reporter_id: reporter.id, reason: "other" });
  expect(neither.error).not.toBeNull();
}, 30000);

test("a moderator can clear an impersonating public name, and the cook is told", async () => {
  const { cook } = await cookWithPublicRecipe("cr-clear");
  await publish(cook.id);
  await admin.from("profiles").update({ public_name: "Someone Else" }).eq("id", cook.id);
  const reporter = await makeUser(`cr-clear-r-${rand()}@t.dev`);
  const { data: rep } = await reporter.client.from("reports")
    .insert({ cook_id: cook.id, reporter_id: reporter.id, reason: "impersonation" })
    .select().single();
  const mod = await moderator("cr-clear");
  const { error } = await mod.client.rpc("resolve_report", {
    p_report_id: rep!.id, p_action: "clear_name", p_reason: "impersonation",
  });
  expect(error).toBeNull();
  const { data: p } = await admin.from("profiles")
    .select("public_name,name_cleared_at,name_cleared_reason").eq("id", cook.id).single();
  expect(p!.public_name).toBeNull();
  expect(p!.name_cleared_at).not.toBeNull();
  expect(p!.name_cleared_reason).toBe("impersonation");
}, 30000);

// The handle is the identity in every public URL, so it is deliberately NOT released.
test("clearing a name leaves the handle alone", async () => {
  const { cook } = await cookWithPublicRecipe("cr-handle");
  await admin.from("profiles").update({ handle: `keep${rand()}` }).eq("id", cook.id);
  const { data: before } = await admin.from("profiles").select("handle").eq("id", cook.id).single();
  const reporter = await makeUser(`cr-handle-r-${rand()}@t.dev`);
  const { data: rep } = await reporter.client.from("reports")
    .insert({ cook_id: cook.id, reporter_id: reporter.id, reason: "impersonation" })
    .select().single();
  const mod = await moderator("cr-handle");
  await mod.client.rpc("resolve_report", {
    p_report_id: rep!.id, p_action: "clear_name", p_reason: "impersonation",
  });
  const { data: after } = await admin.from("profiles").select("handle").eq("id", cook.id).single();
  expect(after!.handle).toBe(before!.handle);
}, 30000);

// 0055. report_insert (0028, extended by 0030) checked only reporter_id, so the ids the row
// CARRIES were unchecked, and those are what the moderator tools act on. Same shape as the
// appeals hole 0053 closed: identity on the owner column is not authority over the subject.
//
// Asserted as the ordinary reporter, never through admin: the service role bypasses RLS, so
// an assertion made through it would pass however broken the policy is.

// A recipe only its own household can read, which is what a stranger must not be able to
// nominate for a takedown.
async function familyOnlyRecipe(prefix: string) {
  const cook = await makeUser(`${prefix}-${rand()}@t.dev`);
  const { data: fam } = await admin.from("families")
    .insert({ name: prefix, created_by: cook.id }).select().single();
  await admin.from("family_members")
    .insert({ family_id: fam!.id, user_id: cook.id, role: "owner" });
  const { data: rec } = await admin.from("recipes")
    .insert({ family_id: fam!.id, author_id: cook.id, title: `R${rand()}`, visibility: "family" })
    .select().single();
  return { cook, fam: fam!, rec: rec! };
}

test("a stranger cannot report a recipe they cannot read", async () => {
  const { rec } = await familyOnlyRecipe("md-unread");
  const stranger = await makeUser(`md-unread-s-${rand()}@t.dev`);
  // They really cannot see it, so this cannot pass by the recipe being absent.
  const { data: seen } = await stranger.client.from("recipes").select("id").eq("id", rec.id);
  expect(seen).toEqual([]);

  const { error } = await stranger.client.from("reports")
    .insert({ recipe_id: rec.id, reporter_id: stranger.id, reason: "offensive" });
  expect(error).not.toBeNull();
  expect(error!.code).toBe("42501");
  const { data: rows } = await admin.from("reports").select("id").eq("recipe_id", rec.id);
  expect(rows).toEqual([]);
}, 30000);

test("a member of the household CAN still report their own family's recipe", async () => {
  // The negative above must not be the whole rule: can_read_recipe is the condition, and a
  // family recipe is readable to its family, so this is the case a tighter
  // "public recipes only" guard would have broken.
  const { fam, rec } = await familyOnlyRecipe("md-kin");
  const kin = await makeUser(`md-kin-r-${rand()}@t.dev`);
  await admin.from("family_members")
    .insert({ family_id: fam.id, user_id: kin.id, role: "member" });
  const { error } = await kin.client.from("reports")
    .insert({ recipe_id: rec.id, reporter_id: kin.id, reason: "offensive" });
  expect(error).toBeNull();
}, 30000);

test("a cook with no public presence cannot be reported", async () => {
  // profiles has no handle until the cook publishes one, and the report button lives on
  // /cooks/:handle. Without this, any account could nominate any private person, including a
  // relative who has never posted anything, for suspension or a name clear.
  const unpublished = await makeUser(`md-nocook-${rand()}@t.dev`);
  const reporter = await makeUser(`md-nocook-r-${rand()}@t.dev`);
  const { error } = await reporter.client.from("reports")
    .insert({ cook_id: unpublished.id, reporter_id: reporter.id, reason: "impersonation" });
  expect(error).not.toBeNull();
  expect(error!.code).toBe("42501");

  // And a published cook still can be, so the rule is "has a public page", not "nobody".
  await admin.from("profiles")
    .update({ handle: `h${rand()}`, public_name: "Ada" }).eq("id", unpublished.id);
  const { error: ok } = await reporter.client.from("reports")
    .insert({ cook_id: unpublished.id, reporter_id: reporter.id, reason: "impersonation" });
  expect(ok).toBeNull();
}, 30000);

test("a reporter cannot file a report that is already resolved", async () => {
  // status is in a partial index (where status = 'open'), so a pre-resolved row walks past
  // reports_one_open_per_reporter AND past the queue: unlimited rows that no rate limit sees.
  // resolved_by is worse in kind: the record of who decided was writable by the person being
  // adjudicated.
  const { rec } = await cookWithPublicRecipe("md-forge");
  const reporter = await makeUser(`md-forge-r-${rand()}@t.dev`);
  const base = { recipe_id: rec.id, reporter_id: reporter.id, reason: "offensive" };

  const dismissed = await reporter.client.from("reports")
    .insert({ ...base, status: "dismissed" });
  expect(dismissed.error?.code).toBe("42501");
  const forged = await reporter.client.from("reports")
    .insert({ ...base, resolved_by: reporter.id, resolved_at: new Date().toISOString() });
  expect(forged.error?.code).toBe("42501");

  // The ordinary report, which sets none of them, still works.
  const { error } = await reporter.client.from("reports").insert(base);
  expect(error).toBeNull();
}, 30000);

test("unpublishing a private recipe does not widen it to the whole family", async () => {
  // A TAKEDOWN MUST NEVER INCREASE WHO CAN SEE A RECIPE. unpublish wrote
  // visibility = 'family' unconditionally, so on a private recipe it was a disclosure rather
  // than a takedown, and the author was then shown a takedown notice on something that was
  // never public. Only reachable through the hole above, which is why it is fixed as well:
  // the guard that depends on another guard is the one that fails when somebody reopens the
  // first. The report is inserted with admin because the policy now refuses it.
  const cook = await makeUser(`md-priv-${rand()}@t.dev`);
  const { data: fam } = await admin.from("families")
    .insert({ name: "md-priv", created_by: cook.id }).select().single();
  await admin.from("family_members")
    .insert({ family_id: fam!.id, user_id: cook.id, role: "owner" });
  const { data: rec } = await admin.from("recipes")
    .insert({ family_id: fam!.id, author_id: cook.id, title: `R${rand()}`, visibility: "private" })
    .select().single();
  const reporter = await makeUser(`md-priv-r-${rand()}@t.dev`);
  const { data: rep } = await admin.from("reports")
    .insert({ recipe_id: rec!.id, reporter_id: reporter.id, reason: "offensive" })
    .select().single();

  const mod = await moderator("md-priv");
  const { error } = await mod.client.rpc("resolve_report", {
    p_report_id: rep!.id, p_action: "unpublish", p_reason: "offensive",
  });
  expect(error).toBeNull();

  const { data: after } = await admin.from("recipes")
    .select("visibility, removed_at").eq("id", rec!.id).single();
  expect(after!.visibility).toBe("private");
  // And it is still a takedown: removed_at is what stops it being published later, so the
  // action must not have become a no-op either.
  expect(after!.removed_at).not.toBeNull();
}, 30000);
