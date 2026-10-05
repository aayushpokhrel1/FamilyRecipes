// @vitest-environment node
// Joining a family must never cost a cook the kitchen of their own, and an invite link must
// be able to name the family before anyone signs in.
//
// The first half is the one that matters. The "everyone has their own kitchen" invariant was
// enforced by the CLIENT: FamilyContext calls ensure_own_kitchen() only when the family list
// comes back empty. A cook whose first membership arrives before that check never gets one.
// Nothing could reach that state until join links existed, which is exactly why it is pinned
// here rather than left to the next person to rediscover.
import { describe, it, expect } from "vitest";
import { admin, anonClient, makeUser } from "./helpers";

const rand = () =>
  Array.from({ length: 8 }, () => String.fromCharCode(97 + Math.floor(Math.random() * 26))).join("");

// A family with a known invite code, owned by someone else: the person doing the joining
// below is always a brand-new cook, as they would be arriving from a link.
async function familyWithCode(name: string) {
  const owner = await makeUser(`jl-owner-${rand()}@t.dev`);
  const code = rand();
  const { data: fam } = await admin.from("families")
    .insert({ name, created_by: owner.id, invite_code: code }).select().single();
  await admin.from("family_members")
    .insert({ family_id: fam!.id, user_id: owner.id, role: "owner" });
  return { owner, fam: fam!, code };
}

const familyIds = async (userId: string) => {
  const { data } = await admin.from("family_members").select("family_id").eq("user_id", userId);
  return (data ?? []).map((r: { family_id: string }) => r.family_id);
};

describe("joining by an invite link", () => {
  // THE ONE THAT WOULD HAVE BROKEN. A cook arriving from a link joins before anything has
  // ever asked for their family list, so the client-side guarantee never fires for them.
  it("still gives a brand-new cook their own kitchen", async () => {
    const { fam, code } = await familyWithCode(`jl-host-${rand()}`);
    const joiner = await makeUser(`jl-new-${rand()}@t.dev`);

    // No ensure_own_kitchen() first, on purpose: that is the client call this test exists to
    // prove the database no longer depends on.
    const { error } = await joiner.client.rpc("join_family_by_code", { p_code: code });
    expect(error).toBeNull();

    const ids = await familyIds(joiner.id);
    expect(ids).toContain(fam.id);
    // Two: the family they were invited to, and the kitchen that is theirs.
    expect(ids).toHaveLength(2);
  }, 30000);

  it("leaves a cook who already has a kitchen with exactly one extra family", async () => {
    const { fam, code } = await familyWithCode(`jl-host2-${rand()}`);
    const joiner = await makeUser(`jl-has-${rand()}@t.dev`);
    await joiner.client.rpc("ensure_own_kitchen");
    const before = await familyIds(joiner.id);
    expect(before).toHaveLength(1);

    await joiner.client.rpc("join_family_by_code", { p_code: code });

    const after = await familyIds(joiner.id);
    expect(after).toHaveLength(2);
    expect(after).toContain(fam.id);
    // The kitchen they already had is still theirs, not replaced.
    expect(after).toContain(before[0]);
  }, 30000);

  it("is idempotent: following the same link twice joins once", async () => {
    const { fam, code } = await familyWithCode(`jl-twice-${rand()}`);
    const joiner = await makeUser(`jl-twice-u-${rand()}@t.dev`);
    await joiner.client.rpc("join_family_by_code", { p_code: code });
    await joiner.client.rpc("join_family_by_code", { p_code: code });

    const ids = await familyIds(joiner.id);
    expect(ids.filter((id) => id === fam.id)).toHaveLength(1);
    expect(ids).toHaveLength(2);
  }, 30000);

  it("refuses an invite code that does not exist", async () => {
    const joiner = await makeUser(`jl-bad-${rand()}@t.dev`);
    const { error } = await joiner.client.rpc("join_family_by_code", { p_code: `nope${rand()}` });
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/invalid invite code/i);
  }, 30000);
});

describe("what an invite link may say before anyone signs in", () => {
  it("names the family to a signed-out visitor holding the code", async () => {
    const name = `jl-named-${rand()}`;
    const { code } = await familyWithCode(name);

    const { data, error } = await anonClient().rpc("family_name_for_code", { p_code: code });
    expect(error).toBeNull();
    expect(data).toBe(name);
  }, 30000);

  // A wrong or rotated code is a normal answer the join page renders, not an error.
  it("answers null for a code nobody holds", async () => {
    const { data, error } = await anonClient()
      .rpc("family_name_for_code", { p_code: `gone${rand()}` });
    expect(error).toBeNull();
    expect(data).toBeNull();
  }, 30000);

  // The name is all it gives. Holding a code must not become a way to read the family row,
  // its id or its members, and a signed-out caller still cannot touch the table itself.
  it("gives up nothing else about the family", async () => {
    const { fam, code } = await familyWithCode(`jl-quiet-${rand()}`);
    const anon = anonClient();

    const direct = await anon.from("families").select("*").eq("invite_code", code);
    expect(direct.data ?? []).toHaveLength(0);

    const members = await anon.from("family_members").select("*").eq("family_id", fam.id);
    expect(members.data ?? []).toHaveLength(0);
  }, 30000);

  // Rotating the code is the revocation, so every link already sent stops naming anything.
  it("stops naming the family once the code is rotated", async () => {
    const { fam, code } = await familyWithCode(`jl-rot-${rand()}`);
    await admin.from("families").update({ invite_code: rand() }).eq("id", fam.id);

    const { data } = await anonClient().rpc("family_name_for_code", { p_code: code });
    expect(data).toBeNull();
  }, 30000);
});
