// @vitest-environment node
// The DB half of remedies and appeals: the hiding rule inside search_recipes, and the appeal
// path that reverses a moderation action. Both live in Postgres, so they are tested against a
// real one.
//
// The hiding rule is asserted on BOTH the searched and the unsearched path, deliberately.
// The equivalent bug before it lived in the unsearched path only: a muted cook stayed in the
// feed until you typed something, because the no-term feed queried `recipes` directly and
// skipped every rule search_recipes held.
import { describe, it, expect } from "vitest";
import { admin, anonClient, makeUser } from "./helpers";

const rand = () =>
  Array.from({ length: 8 }, () => String.fromCharCode(97 + Math.floor(Math.random() * 26))).join("");

// A cook with a family and one PUBLIC recipe whose title is a random word, so a catalogue
// search cannot fuzzy-match anything else. The title is returned so the tests can assert on
// containment rather than on an exact list: a null family id searches the WHOLE catalogue.
async function cookWithPublicRecipe(prefix: string) {
  const cook = await makeUser(`${prefix}-${rand()}@t.dev`);
  const { data: fam } = await admin.from("families")
    .insert({ name: prefix, created_by: cook.id }).select().single();
  await admin.from("family_members")
    .insert({ family_id: fam!.id, user_id: cook.id, role: "owner" });
  const title = rand();
  const { data: rec } = await admin.from("recipes")
    .insert({ family_id: fam!.id, author_id: cook.id, title, visibility: "public" })
    .select().single();
  return { cook, fam: fam!, rec: rec!, title };
}

async function moderator(prefix: string) {
  const m = await makeUser(`${prefix}-mod-${rand()}@t.dev`);
  await admin.from("profiles").update({ is_moderator: true }).eq("id", m.id);
  return m;
}

// The state a moderator's clear_name action leaves behind: the public name is gone, the
// handle is kept, and the timestamp plus reason record why.
async function clearName(cookId: string) {
  await admin.from("profiles")
    .update({ public_name: null, name_cleared_at: new Date().toISOString(),
              name_cleared_reason: "impersonation" })
    .eq("id", cookId);
}

const titles = (rows: any[] | null) => (rows ?? []).map((r: any) => r.title);

describe("a cleared public name hides a cook's recipes from Potluck", () => {
  it("hides the recipe from a search AND from the unsearched feed", async () => {
    const { cook, title } = await cookWithPublicRecipe("ap-hide");
    await clearName(cook.id);
    const stranger = await makeUser(`ap-hide-s-${rand()}@t.dev`);

    const searched = await stranger.client.rpc("search_recipes", {
      p_family_id: null, p_search: title, p_tag_id: null,
    });
    expect(searched.error).toBeNull();
    expect(titles(searched.data)).not.toContain(title);

    // p_search null is exactly what the feed sends when nobody has typed anything, and it is
    // the path the equivalent bug lived in.
    const feed = await stranger.client.rpc("search_recipes", {
      p_family_id: null, p_search: null, p_tag_id: null,
    });
    expect(feed.error).toBeNull();
    expect(titles(feed.data)).not.toContain(title);
  }, 30000);

  it("brings the recipe back once the cook sets a new public name, with no moderator involved", async () => {
    const { cook, title } = await cookWithPublicRecipe("ap-heal");
    await clearName(cook.id);
    const stranger = await makeUser(`ap-heal-s-${rand()}@t.dev`);

    const before = await stranger.client.rpc("search_recipes", {
      p_family_id: null, p_search: null, p_tag_id: null,
    });
    expect(titles(before.data)).not.toContain(title);

    // The cook's own update, through their own client, with no moderator in the loop. This
    // is the self-heal the spec promises, and it is the reason the rule keys on the PAIR of
    // name_cleared_at and public_name rather than on the timestamp alone.
    const { error } = await cook.client.from("profiles")
      .update({ public_name: "Aayush" }).eq("id", cook.id);
    expect(error).toBeNull();

    const after = await stranger.client.rpc("search_recipes", {
      p_family_id: null, p_search: null, p_tag_id: null,
    });
    expect(titles(after.data)).toContain(title);
  }, 30000);

  it("does not hide a cook who was cleared but has since set a public name", async () => {
    const { cook, title } = await cookWithPublicRecipe("ap-named");
    await admin.from("profiles")
      .update({ public_name: "Aayush", name_cleared_at: new Date().toISOString(),
                name_cleared_reason: "impersonation" })
      .eq("id", cook.id);
    const stranger = await makeUser(`ap-named-s-${rand()}@t.dev`);

    const feed = await stranger.client.rpc("search_recipes", {
      p_family_id: null, p_search: null, p_tag_id: null,
    });
    expect(titles(feed.data)).toContain(title);
  }, 30000);
});

describe("one open appeal per cook per subject", () => {
  it("refuses a second appeal for the same subject while the first is unresolved", async () => {
    const { cook } = await cookWithPublicRecipe("ap-dup");
    await clearName(cook.id);
    const row = { cook_id: cook.id, subject_type: "name", body: "I did not impersonate anyone." };

    const first = await cook.client.from("appeals").insert(row);
    expect(first.error).toBeNull();
    const second = await cook.client.from("appeals").insert(row);
    expect(second.error).not.toBeNull();
    expect(second.error!.message).toMatch(/appeals_one_open_per_subject/);
  }, 30000);

  it("lets the cook appeal again once the first appeal is resolved", async () => {
    // The partial index is on the OPEN rows, so a resolved appeal must not block a new one.
    // This is what "a partial index because open is a state" buys, and it is asserted so the
    // index cannot be quietly replaced by a plain unique index.
    const { cook } = await cookWithPublicRecipe("ap-again");
    await clearName(cook.id);
    const { data: first } = await cook.client.from("appeals")
      .insert({ cook_id: cook.id, subject_type: "name", body: "Please look again." })
      .select().single();
    const mod = await moderator("ap-again");
    const { error } = await mod.client.rpc("resolve_appeal", {
      p_appeal: first!.id, p_outcome: "declined", p_note: "the clear stands",
    });
    expect(error).toBeNull();

    const second = await cook.client.from("appeals")
      .insert({ cook_id: cook.id, subject_type: "name", body: "One more time." });
    expect(second.error).toBeNull();
  }, 30000);
});

describe("who may read an appeal", () => {
  it("hides a cook's appeal from another cook and shows it to a moderator", async () => {
    const { cook } = await cookWithPublicRecipe("ap-read");
    await clearName(cook.id);
    const { data: appeal } = await cook.client.from("appeals")
      .insert({ cook_id: cook.id, subject_type: "name", body: "This was a mistake." })
      .select().single();

    const nosy = await makeUser(`ap-read-n-${rand()}@t.dev`);
    const { data: theirs } = await nosy.client.from("appeals").select("id");
    expect(theirs).toEqual([]);

    // The cook still sees their own, which is what the outcome is shown against.
    const { data: mine } = await cook.client.from("appeals").select("id");
    expect(mine!.map((a: any) => a.id)).toContain(appeal!.id);

    const mod = await moderator("ap-read");
    const { data: all } = await mod.client.from("appeals").select("id");
    expect(all!.map((a: any) => a.id)).toContain(appeal!.id);
  }, 30000);
});

describe("granting an appeal performs the undo in the same step", () => {
  it("nulls name_cleared_at and puts the recipe back in the feed", async () => {
    const { cook, title } = await cookWithPublicRecipe("ap-grant");
    await clearName(cook.id);
    const { data: appeal } = await cook.client.from("appeals")
      .insert({ cook_id: cook.id, subject_type: "name", body: "I never impersonated anyone." })
      .select().single();

    const stranger = await makeUser(`ap-grant-s-${rand()}@t.dev`);
    const before = await stranger.client.rpc("search_recipes", {
      p_family_id: null, p_search: null, p_tag_id: null,
    });
    expect(titles(before.data)).not.toContain(title);

    const mod = await moderator("ap-grant");
    const { error } = await mod.client.rpc("resolve_appeal", {
      p_appeal: appeal!.id, p_outcome: "granted", p_note: "checked the handle history",
    });
    expect(error).toBeNull();

    const { data: p } = await admin.from("profiles")
      .select("name_cleared_at,name_cleared_reason").eq("id", cook.id).single();
    expect(p!.name_cleared_at).toBeNull();
    expect(p!.name_cleared_reason).toBeNull();

    // The undo and the resolution are one transaction, so the feed cannot be observed in a
    // state where the appeal reads granted and the recipe is still hidden.
    const after = await stranger.client.rpc("search_recipes", {
      p_family_id: null, p_search: null, p_tag_id: null,
    });
    expect(titles(after.data)).toContain(title);

    const { data: resolved } = await admin.from("appeals")
      .select("outcome,resolved_at,moderator_note").eq("id", appeal!.id).single();
    expect(resolved!.outcome).toBe("granted");
    expect(resolved!.resolved_at).not.toBeNull();
    expect(resolved!.moderator_note).toBe("checked the handle history");
  }, 30000);

  it("refuses to resolve an appeal that is already resolved", async () => {
    const { cook } = await cookWithPublicRecipe("ap-twice");
    await clearName(cook.id);
    const { data: appeal } = await cook.client.from("appeals")
      .insert({ cook_id: cook.id, subject_type: "name", body: "Please reconsider." })
      .select().single();
    const mod = await moderator("ap-twice");
    const first = await mod.client.rpc("resolve_appeal", {
      p_appeal: appeal!.id, p_outcome: "declined", p_note: null,
    });
    expect(first.error).toBeNull();
    const second = await mod.client.rpc("resolve_appeal", {
      p_appeal: appeal!.id, p_outcome: "granted", p_note: null,
    });
    expect(second.error).not.toBeNull();
  }, 30000);
});

describe("resolve_appeal is moderator only", () => {
  it("refuses a non-moderator with insufficient_privilege", async () => {
    const { cook } = await cookWithPublicRecipe("ap-deny");
    await clearName(cook.id);
    const { data: appeal } = await cook.client.from("appeals")
      .insert({ cook_id: cook.id, subject_type: "name", body: "I want this reviewed." })
      .select().single();

    const { error } = await cook.client.rpc("resolve_appeal", {
      p_appeal: appeal!.id, p_outcome: "granted", p_note: null,
    });
    // The CODE matters, not merely that an error happened: a missing function or a missing
    // grant would also produce an error, and neither proves the moderator check exists.
    // 42501 is a refusal.
    expect(error).not.toBeNull();
    expect(error!.code).toBe("42501");

    // And the refusal left the remedy in force.
    const { data: p } = await admin.from("profiles")
      .select("name_cleared_at").eq("id", cook.id).single();
    expect(p!.name_cleared_at).not.toBeNull();
    const { data: still } = await admin.from("appeals")
      .select("resolved_at").eq("id", appeal!.id).single();
    expect(still!.resolved_at).toBeNull();
  }, 30000);

  it("refuses a signed-out caller", async () => {
    const anon = anonClient();
    const { data, error } = await anon.rpc("resolve_appeal", {
      p_appeal: "00000000-0000-0000-0000-000000000000", p_outcome: "granted", p_note: null,
    });
    expect(error).not.toBeNull();
    expect(data).toBeNull();
    expect(error!.code).toBe("42501");
  }, 30000);
});
