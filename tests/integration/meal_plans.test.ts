// @vitest-environment node
// A shared plan is readable by a family member but never editable by them; an
// un-shared plan is invisible to family members. This is the exact RLS class
// that bit v1 (family creation), so it gets explicit coverage.
import { expect, test } from "vitest";
import { admin, makeUser } from "./helpers";

async function famWith(owner: { id: string }, member?: { id: string }) {
  const { data: fam } = await admin.from("families").insert({ name: `Fam${Date.now()}`, created_by: owner.id }).select().single();
  await admin.from("family_members").insert({ family_id: fam!.id, user_id: owner.id, role: "owner" });
  if (member) await admin.from("family_members").insert({ family_id: fam!.id, user_id: member.id, role: "member" });
  return fam!;
}

test("family member can read a shared plan but not edit it; cannot see an unshared one", async () => {
  const alice = await makeUser(`mpa${Date.now()}@t.dev`);
  const bob = await makeUser(`mpb${Date.now()}@t.dev`);
  const fam = await famWith(alice, bob);

  // alice creates a private plan and a shared plan (as herself, through RLS)
  const { data: priv } = await alice.client.from("meal_plans")
    .insert({ owner_id: alice.id, family_id: fam.id, name: "Private" }).select().single();
  const { data: shared } = await alice.client.from("meal_plans")
    .insert({ owner_id: alice.id, family_id: fam.id, name: "Shared", is_shared: true }).select().single();

  // bob sees only the shared plan
  const bobPriv = await bob.client.from("meal_plans").select("id").eq("id", priv!.id);
  expect(bobPriv.data).toHaveLength(0);
  const bobShared = await bob.client.from("meal_plans").select("id").eq("id", shared!.id);
  expect(bobShared.data).toHaveLength(1);

  // bob cannot edit the shared plan (owner-only update)
  const bobEdit = await bob.client.from("meal_plans").update({ name: "Hacked" }).eq("id", shared!.id).select();
  expect(bobEdit.data ?? []).toHaveLength(0);
  const stillNamed = await alice.client.from("meal_plans").select("name").eq("id", shared!.id).single();
  expect(stillNamed.data!.name).toBe("Shared");
});
