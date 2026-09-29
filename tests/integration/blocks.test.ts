// @vitest-environment node
// Mute and block, and the two places they must be respected: the follows policy and the
// public catalogue. Both of those already existed, so this file also re-asserts what they
// did BEFORE, not only what is new.
import { expect, test } from "vitest";
import { admin, makeUser } from "./helpers";

const rand = () =>
  Array.from({ length: 8 }, () => String.fromCharCode(97 + Math.floor(Math.random() * 26))).join("");

// A published cook with one public recipe whose title is a random word, so the catalogue
// search below cannot fuzzy-match anything else.
async function cook(prefix: string) {
  const u = await makeUser(`${prefix}-${rand()}@t.dev`);
  const handle = (prefix + rand()).replace(/[^a-z0-9_]/g, "").slice(0, 30);
  await admin.from("profiles").update({ handle, public_name: prefix }).eq("id", u.id);
  const { data: fam } = await admin.from("families")
    .insert({ name: prefix, created_by: u.id }).select().single();
  await admin.from("family_members")
    .insert({ family_id: fam!.id, user_id: u.id, role: "owner" });
  const title = rand();
  const { data: rec } = await admin.from("recipes")
    .insert({ family_id: fam!.id, author_id: u.id, title, visibility: "public" })
    .select().single();
  return { u, fam: fam!, rec: rec!, title, handle };
}

const titles = (rows: any[] | null) => (rows ?? []).map((r: any) => r.title);

test("a muted cook's recipes leave your catalogue, and yours stay in theirs", async () => {
  const me = await cook("bm-me");
  const them = await cook("bm-them");
  const { error } = await me.u.client.from("blocks")
    .insert({ blocker_id: me.u.id, blocked_id: them.u.id, kind: "mute" });
  expect(error).toBeNull();

  const mine = await me.u.client.rpc("search_recipes", {
    p_family_id: null, p_search: them.title, p_tag_id: null,
  });
  expect(titles(mine.data)).not.toContain(them.title);

  // mute is ONE WAY: they still see me
  const theirs = await them.u.client.rpc("search_recipes", {
    p_family_id: null, p_search: me.title, p_tag_id: null,
  });
  expect(titles(theirs.data)).toContain(me.title);
}, 30000);

test("a blocked cook's recipes leave your catalogue AND yours leave theirs", async () => {
  const me = await cook("bb-me");
  const them = await cook("bb-them");
  await me.u.client.from("blocks")
    .insert({ blocker_id: me.u.id, blocked_id: them.u.id, kind: "block" });

  const mine = await me.u.client.rpc("search_recipes", {
    p_family_id: null, p_search: them.title, p_tag_id: null,
  });
  expect(titles(mine.data)).not.toContain(them.title);

  const theirs = await them.u.client.rpc("search_recipes", {
    p_family_id: null, p_search: me.title, p_tag_id: null,
  });
  expect(titles(theirs.data)).not.toContain(me.title);
}, 30000);

// A block must never reach inside a household. Hiding a recipe from its own family would
// quietly break the vault for everyone in it.
test("a block never hides a recipe inside your own family's vault", async () => {
  const me = await cook("bv-me");
  const them = await makeUser(`bv-them-${rand()}@t.dev`);
  await admin.from("family_members")
    .insert({ family_id: me.fam.id, user_id: them.id, role: "member" });
  const title = rand();
  const { error: recErr } = await admin.from("recipes")
    .insert({ family_id: me.fam.id, author_id: them.id, title, visibility: "family" });
  expect(recErr).toBeNull();

  await me.u.client.from("blocks")
    .insert({ blocker_id: me.u.id, blocked_id: them.id, kind: "block" });

  const vault = await me.u.client.rpc("search_recipes", {
    p_family_id: me.fam.id, p_search: title, p_tag_id: null,
  });
  expect(titles(vault.data)).toContain(title);
}, 30000);

test("blocking removes an existing follow in both directions", async () => {
  const me = await cook("bf-me");
  const them = await cook("bf-them");
  const a = await me.u.client.from("follows")
    .insert({ follower_id: me.u.id, cook_id: them.u.id });
  expect(a.error).toBeNull();
  const b = await them.u.client.from("follows")
    .insert({ follower_id: them.u.id, cook_id: me.u.id });
  expect(b.error).toBeNull();

  await me.u.client.from("blocks")
    .insert({ blocker_id: me.u.id, blocked_id: them.u.id, kind: "block" });

  const { data: left } = await admin.from("follows").select("follower_id,cook_id")
    .or(`and(follower_id.eq.${me.u.id},cook_id.eq.${them.u.id}),and(follower_id.eq.${them.u.id},cook_id.eq.${me.u.id})`);
  expect(left).toEqual([]);
}, 30000);

test("a blocked pair cannot create a follow in either direction", async () => {
  const me = await cook("bn-me");
  const them = await cook("bn-them");
  await me.u.client.from("blocks")
    .insert({ blocker_id: me.u.id, blocked_id: them.u.id, kind: "block" });

  const mine = await me.u.client.from("follows")
    .insert({ follower_id: me.u.id, cook_id: them.u.id });
  expect(mine.error).not.toBeNull();
  const theirs = await them.u.client.from("follows")
    .insert({ follower_id: them.u.id, cook_id: me.u.id });
  expect(theirs.error).not.toBeNull();
}, 30000);

// The follows policy is RESTATED by this migration, so what it always did is re-asserted
// here. Migration 0009 exists only because redefining something silently dropped behaviour.
test("an ordinary follow between unblocked cooks still works", async () => {
  const me = await cook("bo-me");
  const them = await cook("bo-them");
  const { error } = await me.u.client.from("follows")
    .insert({ follower_id: me.u.id, cook_id: them.u.id });
  expect(error).toBeNull();
  const { data } = await me.u.client.from("follows").select("cook_id");
  expect((data ?? []).map((r: any) => r.cook_id)).toContain(them.u.id);
}, 30000);

// Unchanged from 0023 and re-asserted for the same reason: you may only follow a cook who
// has published (has a handle).
test("you still cannot follow an unpublished cook", async () => {
  const me = await cook("bu-me");
  const nobody = await makeUser(`bu-nobody-${rand()}@t.dev`);
  const { error } = await me.u.client.from("follows")
    .insert({ follower_id: me.u.id, cook_id: nobody.id });
  expect(error).not.toBeNull();
}, 30000);

// A block the other person can discover is not a block. The read policy is the blocker's
// alone, which is also why nothing notifies them.
test("a blocked cook cannot see that they were blocked", async () => {
  const me = await cook("bs-me");
  const them = await cook("bs-them");
  await me.u.client.from("blocks")
    .insert({ blocker_id: me.u.id, blocked_id: them.u.id, kind: "block" });
  const { data } = await them.u.client.from("blocks").select("*");
  expect(data).toEqual([]);
}, 30000);

// The bug this file's first two tests did NOT catch: they call search_recipes directly, but
// Potluck's default view has no search term, and that path used to query `recipes` directly
// and skip the filter entirely. A muted cook stayed in the feed until you typed something.
// This asserts the UNSEARCHED catalogue, which is what the page actually shows.
test("a muted cook leaves the unsearched catalogue too, not only a search", async () => {
  const me = await cook("bq-me");
  const them = await cook("bq-them");
  await me.u.client.from("blocks")
    .insert({ blocker_id: me.u.id, blocked_id: them.u.id, kind: "mute" });

  // p_search null is exactly what the feed sends when nobody has typed anything.
  const feed = await me.u.client.rpc("search_recipes", {
    p_family_id: null, p_search: null, p_tag_id: null,
  });
  expect(titles(feed.data)).not.toContain(them.title);
  expect(titles(feed.data)).toContain(me.title);
}, 30000);
