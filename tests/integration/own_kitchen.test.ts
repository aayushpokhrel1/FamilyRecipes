// @vitest-environment node
// The invariant that a cook always has at least one kitchen, tested at the database level
// because the whole thing is a function plus two inserts and only Postgres can prove it.
//
// Every call goes through client.rpc, because a direct insert would be testing a door that
// does not exist: the point is that the CALLER can do this, with their own JWT, and get a
// kitchen back.
import { describe, it, expect } from "vitest";
import { admin, anonClient, makeUser } from "./helpers";

const stamp = () => Date.now() + Math.floor(Math.random() * 1000);

async function memberships(userId: string) {
  const { data } = await admin.from("family_members").select("family_id,role").eq("user_id", userId);
  return data ?? [];
}

describe("every cook has at least one kitchen", () => {
  it("starts a brand-new cook with no family at all", async () => {
    // The precondition of the defect, pinned so it cannot quietly change. handle_new_user()
    // creates a profile and nothing else, which is exactly why Save did nothing.
    const cook = await makeUser(`kitchen-none-${stamp()}@t.dev`);
    expect(await memberships(cook.id)).toEqual([]);
  });

  it("gives a cook with no family exactly one kitchen, and makes them its owner", async () => {
    const cook = await makeUser(`kitchen-one-${stamp()}@t.dev`);
    const { data: familyId, error } = await cook.client.rpc("ensure_own_kitchen");
    expect(error).toBeNull();
    expect(familyId).toBeTruthy();

    const rows = await memberships(cook.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].family_id).toBe(familyId);
    // Owner, not member: a kitchen nobody owns cannot be renamed, invited to or deleted,
    // because families_owner_update and the member-removal policy both key on the role.
    expect(rows[0].role).toBe("owner");

    const { data: family } = await admin.from("families")
      .select("created_by").eq("id", familyId).single();
    expect(family!.created_by).toBe(cook.id);
  });

  it("returns the same kitchen on a second call and creates no second row", async () => {
    // This is the test that matters most, because the caller runs it on every load. React's
    // StrictMode runs that effect twice in development, so a non-idempotent version would
    // hand a cook two kitchens on their first page view.
    const cook = await makeUser(`kitchen-twice-${stamp()}@t.dev`);
    const first = await cook.client.rpc("ensure_own_kitchen");
    const second = await cook.client.rpc("ensure_own_kitchen");
    expect(first.error).toBeNull();
    expect(second.error).toBeNull();
    expect(second.data).toBe(first.data);
    expect(await memberships(cook.id)).toHaveLength(1);
  });

  it("names the kitchen 'My kitchen' when the display name is still the default", async () => {
    // display_name defaults to the literal 'Cook' in 0001, so this is what a cook who never
    // set a name has. The name is PUBLIC through public_recipe_bylines, so "Cook's kitchen"
    // would be visible nonsense under every recipe they publish.
    const cook = await makeUser(`kitchen-default-${stamp()}@t.dev`);
    const { data: familyId } = await cook.client.rpc("ensure_own_kitchen");
    const { data: family } = await admin.from("families")
      .select("name").eq("id", familyId).single();
    expect(family!.name).toBe("My kitchen");
  });

  it("names the kitchen after the cook when they have set a display name", async () => {
    const cook = await makeUser(`kitchen-named-${stamp()}@t.dev`);
    // Set through admin, before the call, because the function reads the profile at the
    // moment it creates the family.
    await admin.from("profiles").update({ display_name: "Aayush" }).eq("id", cook.id);
    const { data: familyId } = await cook.client.rpc("ensure_own_kitchen");
    const { data: family } = await admin.from("families")
      .select("name").eq("id", familyId).single();
    expect(family!.name).toBe("Aayush's kitchen");
  });

  it("leaves a cook who already belongs to a family alone", async () => {
    // The invariant is "at least one", not "exactly one of their own". A cook who joined
    // their mother's family must not be handed a spare kitchen on every load.
    const cook = await makeUser(`kitchen-joined-${stamp()}@t.dev`);
    const { data: family } = await admin.from("families")
      .insert({ name: "Pokhrel", created_by: cook.id }).select().single();
    await admin.from("family_members")
      .insert({ family_id: family!.id, user_id: cook.id, role: "owner" });

    const { data: returned, error } = await cook.client.rpc("ensure_own_kitchen");
    expect(error).toBeNull();
    expect(returned).toBe(family!.id);
    expect(await memberships(cook.id)).toHaveLength(1);
  });

  it("refuses a signed-out caller", async () => {
    // anon has no execute grant, so this is a refusal rather than a kitchen. A client with
    // no session is what a stranger on the internet is, and it must not be able to create
    // families.
    const anon = anonClient();
    const { data, error } = await anon.rpc("ensure_own_kitchen");
    expect(error).not.toBeNull();
    expect(data).toBeNull();
    // The code matters, not just the presence of an error. Before the migration existed this
    // test passed on PGRST202 ("no such function"), which proves nothing about the grant.
    // 42501 is a REFUSAL.
    expect(error?.code).toBe("42501");
  });
});
