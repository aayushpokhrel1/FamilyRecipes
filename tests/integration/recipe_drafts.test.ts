// @vitest-environment node
// A draft belongs to its AUTHOR alone. The whole ownership decision is that a draft is
// unfinished thinking, not family property, so the test that matters most here puts two
// cooks in ONE family and proves the second still cannot see the first's draft. Membership
// is not enough, and that is the point.
import { describe, it, expect } from "vitest";
import { admin, anonClient, makeUser } from "./helpers";

const stamp = () => Date.now() + Math.floor(Math.random() * 1000);

// Both cooks go in the SAME family, deliberately. A test that put them in different families
// would pass even if a family-member policy existed, which is the bug this file exists to
// catch.
async function familyWith(owner: { id: string }, member: { id: string }) {
  const { data: fam } = await admin.from("families")
    .insert({ name: `Drafts${stamp()}`, created_by: owner.id }).select().single();
  await admin.from("family_members")
    .insert({ family_id: fam!.id, user_id: owner.id, role: "owner" });
  await admin.from("family_members")
    .insert({ family_id: fam!.id, user_id: member.id, role: "member" });
  return fam!;
}

const body = { ingredients: [{ item: "flour" }], steps: [{ text: "mix" }] };

describe("recipe drafts belong to their author", () => {
  it("lets a cook insert, list, update and delete their own draft", async () => {
    const cook = await makeUser(`draft-own-${stamp()}@t.dev`);
    const fam = await familyWith(cook, await makeUser(`draft-own-other-${stamp()}@t.dev`));

    const { data: created, error } = await cook.client.from("recipe_drafts")
      .insert({ author_id: cook.id, target_family_id: fam.id, title: "Half a cake", body })
      .select().single();
    expect(error).toBeNull();
    expect(created!.title).toBe("Half a cake");

    const listed = await cook.client.from("recipe_drafts").select("id,title");
    expect(listed.data).toHaveLength(1);
    expect(listed.data![0].id).toBe(created!.id);

    const updated = await cook.client.from("recipe_drafts")
      .update({ title: "A whole cake" }).eq("id", created!.id).select().single();
    expect(updated.error).toBeNull();
    expect(updated.data!.title).toBe("A whole cake");

    const deleted = await cook.client.from("recipe_drafts")
      .delete().eq("id", created!.id).select();
    expect(deleted.data).toHaveLength(1);
    const after = await cook.client.from("recipe_drafts").select("id");
    expect(after.data).toHaveLength(0);
  });

  it("hides a cook's draft from another cook in the SAME family", async () => {
    // The clearest test in the file, and the whole ownership decision. Both cooks are in one
    // family, so a family-member policy would let bob read this. A draft is not family
    // property, so he must not, and the select returns nothing rather than an error.
    const alice = await makeUser(`draft-alice-${stamp()}@t.dev`);
    const bob = await makeUser(`draft-bob-${stamp()}@t.dev`);
    const fam = await familyWith(alice, bob);

    const { data: draft } = await alice.client.from("recipe_drafts")
      .insert({ author_id: alice.id, target_family_id: fam.id, title: "Alice's secret", body })
      .select().single();

    const bobRead = await bob.client.from("recipe_drafts").select("id").eq("id", draft!.id);
    expect(bobRead.data).toHaveLength(0);

    // And he cannot reach it by writing either: update and delete both filter to zero rows.
    const bobEdit = await bob.client.from("recipe_drafts")
      .update({ title: "Hacked" }).eq("id", draft!.id).select();
    expect(bobEdit.data ?? []).toHaveLength(0);
    const bobDelete = await bob.client.from("recipe_drafts")
      .delete().eq("id", draft!.id).select();
    expect(bobDelete.data ?? []).toHaveLength(0);

    // Alice's draft is untouched, which is what proves the writes were refused rather than
    // merely invisible.
    const stillThere = await alice.client.from("recipe_drafts")
      .select("title").eq("id", draft!.id).single();
    expect(stillThere.data!.title).toBe("Alice's secret");
  });

  it("shows an anonymous client no drafts at all", async () => {
    const cook = await makeUser(`draft-anon-${stamp()}@t.dev`);
    const fam = await familyWith(cook, await makeUser(`draft-anon-other-${stamp()}@t.dev`));
    await cook.client.from("recipe_drafts")
      .insert({ author_id: cook.id, target_family_id: fam.id, title: "Private", body });

    // anonClient has the anon key and NO session, which is what a stranger on the internet
    // is. makeUser's client is also built from the anon key but is signed in, so it cannot
    // prove anything about anonymous access.
    const anon = anonClient();
    const { data } = await anon.from("recipe_drafts").select("id");
    expect(data ?? []).toHaveLength(0);
    // The row MUST exist for the line above to mean anything. Without this, "anon sees
    // nothing" is equally true of a table that was never created, which is how this test
    // passed before the migration existed.
    const { data: real } = await admin.from("recipe_drafts").select("id").eq("author_id", cook.id);
    expect(real).toHaveLength(1);
  });

  it("rejects a draft with no title", async () => {
    const cook = await makeUser(`draft-notitle-${stamp()}@t.dev`);
    const fam = await familyWith(cook, await makeUser(`draft-notitle-other-${stamp()}@t.dev`));

    const { error } = await cook.client.from("recipe_drafts")
      .insert({ author_id: cook.id, target_family_id: fam.id, body });
    // 23502 is not_null_violation. Asserting the CODE and not merely "an error happened" is
    // the difference between testing the constraint and testing that the table is missing.
    expect(error?.code).toBe("23502");
  });

  it("rejects a draft with no target family", async () => {
    const cook = await makeUser(`draft-nofam-${stamp()}@t.dev`);
    await familyWith(cook, await makeUser(`draft-nofam-other-${stamp()}@t.dev`));

    const { error } = await cook.client.from("recipe_drafts")
      .insert({ author_id: cook.id, title: "No target", body });
    expect(error?.code).toBe("23502");
  });
});
