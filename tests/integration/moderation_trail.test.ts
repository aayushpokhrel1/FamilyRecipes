// @vitest-environment node
// THE TRAIL (0066). A moderator action used to leave its reason behind and not its author, and
// this is the proof that it now leaves both.
//
// Everything here is asserted through a REAL USER'S CLIENT, never through `admin`. The service
// role bypasses RLS, so an assertion made through it passes however broken the policy is, which
// is the rule CLAUDE.md states and the reason the 2026-10-12 audit found six policies that read
// perfectly and held nothing. `admin` is used only to SET UP: to create the fixture rows and to
// hand out the moderator flag, which no client may do.
//
// The read side matters as much as the write side here. `moderation_events` has ONE select
// policy and no insert, update or delete policy at all, so three of these tests are about what
// a moderator CANNOT do to the record of what they did. A trail the actor can edit is worse
// than no trail, because it would be believed.
import { describe, it, expect } from "vitest";
import { admin, anonClient, makeUser } from "./helpers";

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

async function moderator(prefix: string) {
  const m = await makeUser(`${prefix}-mod-${rand()}@t.dev`);
  await admin.from("profiles").update({ is_moderator: true }).eq("id", m.id);
  return m;
}

// A report is reportable only by someone who could have seen it (0055), and a cook report needs
// a published cook, which is why the handle is set here.
async function publish(cookId: string) {
  await admin.from("profiles")
    .update({ handle: `h${rand()}`, public_name: "Ada" }).eq("id", cookId);
}

async function openReport(recipeId: string, prefix: string) {
  const reporter = await makeUser(`${prefix}-rep-${rand()}@t.dev`);
  const { data } = await admin.from("reports")
    .insert({ recipe_id: recipeId, reporter_id: reporter.id, reason: "not_a_recipe" })
    .select().single();
  return data!;
}

describe("a resolved report names its author and its action", () => {
  it("writes one trail row, and records WHICH action the report row got", async () => {
    const { rec } = await cookWithPublicRecipe("tr-rep");
    const report = await openReport(rec.id, "tr-rep");
    const mod = await moderator("tr-rep");

    const resolved = await mod.client.rpc("resolve_report", {
      p_report_id: report.id, p_action: "unpublish", p_reason: "not a recipe",
    });
    expect(resolved.error).toBeNull();

    // THROUGH THE MODERATOR'S OWN CLIENT, so the select policy is what permits this read.
    const { data: events, error } = await mod.client
      .from("moderation_events")
      .select("action, via, actor_id, subject_recipe, report_id, reason")
      .eq("report_id", report.id);
    expect(error).toBeNull();
    expect(events).toHaveLength(1);
    expect(events![0].actor_id).toBe(mod.id);
    // 'unpublish' is deliberately NOT the stored action: the console's takedown_recipe does the
    // same thing to the same row, and a reader asking when a recipe came down should not have
    // to know which door it came through.
    expect(events![0].action).toBe("takedown_recipe");
    expect(events![0].via).toBe("report");
    expect(events![0].subject_recipe).toBe(rec.id);
    expect(events![0].reason).toBe("not a recipe");

    // The gap this closed on the report row itself: three of the four actions all produced
    // status = 'actioned', so the row said an action happened and not which one.
    const { data: row } = await mod.client
      .from("reports").select("status, resolved_by, resolved_action").eq("id", report.id).single();
    expect(row!.status).toBe("actioned");
    expect(row!.resolved_by).toBe(mod.id);
    expect(row!.resolved_action).toBe("unpublish");
  }, 30000);

  it("names no single recipe for a suspension, which takes several down", async () => {
    const { cook, rec } = await cookWithPublicRecipe("tr-susp");
    await publish(cook.id);
    const report = await openReport(rec.id, "tr-susp");
    const mod = await moderator("tr-susp");

    await mod.client.rpc("resolve_report", {
      p_report_id: report.id, p_action: "suspend", p_reason: "spam",
    });

    const { data: events } = await mod.client
      .from("moderation_events")
      .select("action, subject_cook, subject_recipe")
      .eq("report_id", report.id);
    expect(events).toHaveLength(1);
    expect(events![0].action).toBe("suspend");
    expect(events![0].subject_cook).toBe(cook.id);
    // Naming one of the several recipes a suspension removes would be a claim the row cannot
    // support.
    expect(events![0].subject_recipe).toBeNull();
  }, 30000);

  it("records a dismissal, which is a decision and not an absence of one", async () => {
    const { rec } = await cookWithPublicRecipe("tr-dis");
    const report = await openReport(rec.id, "tr-dis");
    const mod = await moderator("tr-dis");

    await mod.client.rpc("resolve_report", {
      p_report_id: report.id, p_action: "dismiss", p_reason: "nothing wrong with it",
    });

    const { data: events } = await mod.client
      .from("moderation_events").select("action, via").eq("report_id", report.id);
    expect(events).toHaveLength(1);
    expect(events![0].action).toBe("dismiss_report");
  }, 30000);
});

describe("a resolved appeal names its author, and its remedy separately", () => {
  it("writes TWO rows for a granted appeal: the outcome, and the undo it performed", async () => {
    const { cook } = await cookWithPublicRecipe("tr-ap");
    await admin.from("profiles")
      .update({ suspended_at: new Date().toISOString(), suspended_reason: "spam" })
      .eq("id", cook.id);
    const { data: appeal } = await admin.from("appeals")
      .insert({ cook_id: cook.id, subject_type: "suspension", body: "it was not me" })
      .select().single();
    const mod = await moderator("tr-ap");

    const resolved = await mod.client.rpc("resolve_appeal", {
      p_appeal: appeal!.id, p_outcome: "granted", p_note: "accepted",
    });
    expect(resolved.error).toBeNull();

    const { data: events } = await mod.client
      .from("moderation_events")
      .select("action, via, actor_id, subject_cook")
      .eq("appeal_id", appeal!.id);
    // Not duplication: "this appeal was granted" and "this cook's suspension was lifted on the
    // strength of it" are different facts, and the second is what explains why a suspension
    // earlier in the trail has no matching unsuspend.
    expect(events).toHaveLength(2);
    const actions = (events ?? []).map((e) => e.action).sort();
    expect(actions).toEqual(["grant_appeal", "unsuspend"]);
    for (const e of events!) {
      expect(e.actor_id).toBe(mod.id);
      expect(e.subject_cook).toBe(cook.id);
      expect(e.via).toBe("appeal");
    }

    // The gap this closed on the appeal row itself: it recorded what was decided and not by whom.
    const { data: row } = await mod.client
      .from("appeals").select("outcome, resolved_by").eq("id", appeal!.id).single();
    expect(row!.outcome).toBe("granted");
    expect(row!.resolved_by).toBe(mod.id);
  }, 30000);

  it("writes ONE row for a declined appeal, because no remedy was performed", async () => {
    const { cook } = await cookWithPublicRecipe("tr-dec");
    const { data: appeal } = await admin.from("appeals")
      .insert({ cook_id: cook.id, subject_type: "name", body: "that is my real name" })
      .select().single();
    const mod = await moderator("tr-dec");

    await mod.client.rpc("resolve_appeal", {
      p_appeal: appeal!.id, p_outcome: "declined", p_note: "no",
    });

    const { data: events } = await mod.client
      .from("moderation_events").select("action").eq("appeal_id", appeal!.id);
    expect(events).toHaveLength(1);
    expect(events![0].action).toBe("decline_appeal");
  }, 30000);
});

describe("the trail is readable by moderators and writable by nobody", () => {
  it("shows a cook nothing, including the row that names them", async () => {
    const { rec, cook } = await cookWithPublicRecipe("tr-priv");
    const report = await openReport(rec.id, "tr-priv");
    const mod = await moderator("tr-priv");
    await mod.client.rpc("resolve_report", {
      p_report_id: report.id, p_action: "unpublish", p_reason: "no",
    });

    // THE SUBJECT OF THE ACTION. It names who acted on them, and handing that over is a safety
    // problem rather than a transparency win. A select refused by RLS returns an empty list and
    // NO error, which is the shape that produced three bugs in one day: never read `error` here
    // and conclude anything from it being null.
    const subject = await cook.client.from("moderation_events").select("id");
    expect(subject.error).toBeNull();
    expect(subject.data).toEqual([]);

    const stranger = await makeUser(`tr-priv-s-${rand()}@t.dev`);
    const nosy = await stranger.client.from("moderation_events").select("id");
    expect(nosy.data).toEqual([]);

    const { data: anonRows } = await anonClient().from("moderation_events").select("id");
    expect(anonRows ?? []).toEqual([]);
  }, 30000);

  it("refuses an insert from a moderator, who is the one person who would want to forge one", async () => {
    const mod = await moderator("tr-forge");
    const victim = await makeUser(`tr-forge-v-${rand()}@t.dev`);

    // There is no insert policy at all, which is the strictest setting rather than a gap. An
    // INSERT refused by RLS is a real error, unlike a refused update or select.
    //
    // WHICH LOCK ACTUALLY HOLDS THIS, measured by breaking each one in turn on 2026-10-26: the
    // REVOKE, not the missing policy. Adding a permissive insert policy left this test green,
    // because `authenticated` has no insert privilege to exercise it with; granting the
    // privilege is what turned it red. So the revoke in 0066 is not belt-and-braces over the
    // policy, it is the part doing the work, and removing it on the grounds that RLS covers
    // writes would open exactly this.
    const forged = await mod.client.from("moderation_events").insert({
      actor_id: victim.id, action: "delete_user", via: "direct", subject_cook: victim.id,
    });
    expect(forged.error).not.toBeNull();
  }, 30000);

  it("refuses an update and a delete, so an actor cannot revise their own record", async () => {
    const { rec } = await cookWithPublicRecipe("tr-rev");
    const report = await openReport(rec.id, "tr-rev");
    const mod = await moderator("tr-rev");
    await mod.client.rpc("resolve_report", {
      p_report_id: report.id, p_action: "dismiss", p_reason: "the original reason",
    });
    const { data: before } = await mod.client
      .from("moderation_events").select("id, reason").eq("report_id", report.id).single();

    // Both of these resolve with error: null and affect ZERO rows, because a policy does not
    // reject a row, it fails to match one. The assertion has to be on the row, never on the
    // error, which is the whole of silent_refusals.test.ts.
    await mod.client.from("moderation_events")
      .update({ reason: "a tidier reason" }).eq("id", before!.id);
    await mod.client.from("moderation_events").delete().eq("id", before!.id);

    const { data: after } = await mod.client
      .from("moderation_events").select("id, reason").eq("id", before!.id).maybeSingle();
    expect(after).not.toBeNull();
    expect(after!.reason).toBe("the original reason");
  }, 30000);
});

describe("is_owner is the authority that hands out authority", () => {
  it("cannot be set by a cook on their own row, nor by a moderator on anyone", async () => {
    const cook = await makeUser(`tr-own-${rand()}@t.dev`);

    // profiles has COLUMN-LEVEL update grants (0047) on six named columns, and is_owner is not
    // among them. That omission is the mechanism: profiles_self_update still passes, because the
    // row IS theirs, and the grant is what refuses the column. The same shape as is_moderator,
    // which was a one-request path to moderator the day 0028 added it.
    const self = await cook.client.from("profiles")
      .update({ is_owner: true }).eq("id", cook.id).select();
    expect(self.data ?? []).toEqual([]);

    const mod = await moderator("tr-own");
    const other = await mod.client.from("profiles")
      .update({ is_owner: true }).eq("id", cook.id).select();
    expect(other.data ?? []).toEqual([]);

    // Read it back with the service role, which is legitimate here: this asserts the STATE of
    // the row, not that a policy permitted something. Nothing above was asserted through it.
    const { data: row } = await admin.from("profiles").select("is_owner").eq("id", cook.id).single();
    expect(row!.is_owner).toBe(false);
  }, 30000);
});
