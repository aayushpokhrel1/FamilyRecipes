// @vitest-environment node
// Integration tests hit a real Postgres and need no DOM. The node environment
// avoids jsdom's shared localStorage, which otherwise leaks auth sessions
// between the supabase clients (see helpers.ts).
import { expect, test } from "vitest";
import { admin, makeUser } from "./helpers";

test("family recipe is visible to a member, hidden from a non-member", async () => {
  const alice = await makeUser(`alice${Date.now()}@t.dev`);
  const bob = await makeUser(`bob${Date.now()}@t.dev`);

  // alice creates a family and an owner membership (via service role to bypass ordering)
  const { data: fam } = await admin.from("families")
    .insert({ name: "Alice Fam", created_by: alice.id }).select().single();
  await admin.from("family_members")
    .insert({ family_id: fam!.id, user_id: alice.id, role: "owner" });

  const { data: rec } = await admin.from("recipes").insert({
    family_id: fam!.id, author_id: alice.id, title: "Dal", visibility: "family",
  }).select().single();

  // alice (member) can read
  const asAlice = await alice.client.from("recipes").select("id").eq("id", rec!.id);
  expect(asAlice.data).toHaveLength(1);

  // bob (non-member) cannot
  const asBob = await bob.client.from("recipes").select("id").eq("id", rec!.id);
  expect(asBob.data).toHaveLength(0);
});

test("private recipe is hidden even from family members", async () => {
  const alice = await makeUser(`a2${Date.now()}@t.dev`);
  const carol = await makeUser(`c2${Date.now()}@t.dev`);
  const { data: fam } = await admin.from("families").insert({ name: "F2", created_by: alice.id }).select().single();
  await admin.from("family_members").insert([
    { family_id: fam!.id, user_id: alice.id, role: "owner" },
    { family_id: fam!.id, user_id: carol.id, role: "member" },
  ]);
  const { data: rec } = await admin.from("recipes").insert({
    family_id: fam!.id, author_id: alice.id, title: "Secret", visibility: "private",
  }).select().single();
  const asCarol = await carol.client.from("recipes").select("id").eq("id", rec!.id);
  expect(asCarol.data).toHaveLength(0);
});

test("public recipe is readable by anyone", async () => {
  const alice = await makeUser(`a3${Date.now()}@t.dev`);
  const stranger = await makeUser(`s3${Date.now()}@t.dev`);
  const { data: fam } = await admin.from("families").insert({ name: "F3", created_by: alice.id }).select().single();
  await admin.from("family_members").insert({ family_id: fam!.id, user_id: alice.id, role: "owner" });
  const { data: rec } = await admin.from("recipes").insert({
    family_id: fam!.id, author_id: alice.id, title: "Open", visibility: "public",
  }).select().single();
  const asStranger = await stranger.client.from("recipes").select("id").eq("id", rec!.id);
  expect(asStranger.data).toHaveLength(1);
});

test("a user can join a family by invite code and then read its recipes", async () => {
  const alice = await makeUser(`a4${Date.now()}@t.dev`);
  const bob = await makeUser(`b4${Date.now()}@t.dev`);
  const { data: fam } = await admin.from("families")
    .insert({ name: "JoinFam", created_by: alice.id }).select().single();
  await admin.from("family_members").insert({ family_id: fam!.id, user_id: alice.id, role: "owner" });
  const { data: rec } = await admin.from("recipes").insert({
    family_id: fam!.id, author_id: alice.id, title: "Shared", visibility: "family",
  }).select().single();

  // bob cannot see the family recipe before joining
  let asBob = await bob.client.from("recipes").select("id").eq("id", rec!.id);
  expect(asBob.data).toHaveLength(0);

  // bob joins via the RPC using the invite code (a plain select would be blocked by RLS)
  const { error: joinErr } = await bob.client.rpc("join_family_by_code", { p_code: fam!.invite_code });
  expect(joinErr).toBeNull();

  // now bob can read it
  asBob = await bob.client.from("recipes").select("id").eq("id", rec!.id);
  expect(asBob.data).toHaveLength(1);
});
