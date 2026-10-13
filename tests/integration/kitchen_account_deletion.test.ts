// @vitest-environment node
//
// THE KITCHEN SCHEMA MUST NOT BE ABLE TO VETO ACCOUNT DELETION.
//
// Eight attribution columns in `kitchen` point at auth.users. Every one of them was written
// without an ON DELETE action, which is NO ACTION: Postgres refuses to remove the login while
// any of those rows exists. `delete-account` blanks the profile FIRST and calls
// auth.admin.deleteUser LAST, so for anyone who had ever started an org, written a dish
// version, signed one off, recorded a deviation, published, or minted or used an invite, the
// deletion failed at the last step and left the worst possible state: identity blanked, login
// still live, and a 500 telling the person it did not work.
//
// Neither deletion path touches this schema, and `deletion_parity.test.ts` compares the two
// paths with each other rather than against the database, so nothing caught it.
import { describe, it, expect } from "vitest";
import { admin, makeUser } from "./helpers";

const stamp = () => Date.now() + Math.floor(Math.random() * 1000);
const kitchen = (c: Awaited<ReturnType<typeof makeUser>>["client"]) => c.schema("kitchen");

describe("deleting the login of somebody who worked in a kitchen", () => {
  it("succeeds for an owner who started an org, a site, a dish and an invite", async () => {
    const owner = await makeUser(`kit-del-owner-${stamp()}@t.dev`);
    const { data: orgId } = await kitchen(owner.client).rpc("create_org", {
      p_name: "Deletion Group",
      p_display_name: "Sam",
    });
    const { data: siteId } = await kitchen(owner.client).rpc("add_site", {
      p_org: orgId,
      p_name: "Shoreditch",
    });
    const { data: dishId } = await kitchen(owner.client).rpc("create_dish", {
      p_org: orgId,
      p_title: "Soup",
    });
    await kitchen(owner.client).rpc("revise_dish", {
      p_dish: dishId,
      p_note: "first",
      p_ingredients: [{ position: 1, item: "water" }],
      p_steps: [{ position: 1, text: "boil it" }],
    });
    await kitchen(owner.client).rpc("send_to_trial", { p_dish: dishId, p_site: siteId });
    const { data: versions } = await kitchen(owner.client)
      .from("dish_versions")
      .select("id")
      .eq("dish_id", dishId);
    await kitchen(owner.client).rpc("sign_off", { p_version: versions![0].id });
    await kitchen(owner.client).rpc("record_deviation", {
      p_dish: dishId,
      p_site: siteId,
      p_note: "less salt",
    });
    await kitchen(owner.client).rpc("create_invite", {
      p_org: orgId,
      p_role: "cook",
      p_site: siteId,
    });

    // The whole finding is in this one call. It is the LAST thing delete-account does.
    const { error } = await admin.auth.admin.deleteUser(owner.id);
    expect(error).toBeNull();

    // The attribution rows survive with nobody named, which is what erasure means here: the
    // group keeps its dish and its history, and the person is no longer in it.
    const { data: dish } = await admin.schema("kitchen").from("dishes").select("created_by")
      .eq("id", dishId).maybeSingle();
    expect(dish?.created_by).toBeNull();
    const { data: org } = await admin.schema("kitchen").from("orgs").select("created_by")
      .eq("id", orgId).maybeSingle();
    expect(org?.created_by).toBeNull();
  });

  it("succeeds for somebody who only accepted an invite", async () => {
    const owner = await makeUser(`kit-del-inv-o-${stamp()}@t.dev`);
    const { data: orgId } = await kitchen(owner.client).rpc("create_org", {
      p_name: "Invite Group",
      p_display_name: "Sam",
    });
    const { data: code } = await kitchen(owner.client).rpc("create_invite", {
      p_org: orgId,
      p_role: "chef",
      p_site: null,
    });
    const chef = await makeUser(`kit-del-inv-c-${stamp()}@t.dev`);
    await kitchen(chef.client).rpc("accept_invite", { p_code: code, p_display_name: "Ada" });

    const { error } = await admin.auth.admin.deleteUser(chef.id);
    expect(error).toBeNull();
    // used_by is attribution too, and the staff row goes because employment is not a record
    // worth keeping about somebody who no longer exists.
    const { data: invite } = await admin.schema("kitchen").from("staff_invites")
      .select("used_by,used_at").eq("code", code).maybeSingle();
    expect(invite?.used_by).toBeNull();
    expect(invite?.used_at).not.toBeNull();
  });
});

describe("the last owner of an org", () => {
  it("cannot delete their own staff row over the API, which would leave the org with nobody who may administer it", async () => {
    const owner = await makeUser(`kit-last-owner-${stamp()}@t.dev`);
    const { data: orgId } = await kitchen(owner.client).rpc("create_org", {
      p_name: "Last Owner Group",
      p_display_name: "Sam",
    });
    // A refused DELETE matches no rows rather than raising, so the proof is that the row is
    // still there, never that an error came back.
    await kitchen(owner.client).from("staff").delete().eq("org_id", orgId).eq("user_id", owner.id);
    const { data: still } = await admin.schema("kitchen").from("staff").select("role")
      .eq("org_id", orgId).eq("user_id", owner.id).maybeSingle();
    expect(still?.role).toBe("owner");
  });

  it("may still leave once there is a second owner", async () => {
    const owner = await makeUser(`kit-two-owners-a-${stamp()}@t.dev`);
    const { data: orgId } = await kitchen(owner.client).rpc("create_org", {
      p_name: "Two Owners Group",
      p_display_name: "Sam",
    });
    const { data: code } = await kitchen(owner.client).rpc("create_invite", {
      p_org: orgId,
      p_role: "owner",
      p_site: null,
    });
    const second = await makeUser(`kit-two-owners-b-${stamp()}@t.dev`);
    await kitchen(second.client).rpc("accept_invite", { p_code: code, p_display_name: "Ada" });

    await kitchen(owner.client).from("staff").delete().eq("org_id", orgId).eq("user_id", owner.id);
    const { data: gone } = await admin.schema("kitchen").from("staff").select("role")
      .eq("org_id", orgId).eq("user_id", owner.id).maybeSingle();
    expect(gone).toBeNull();
  });
});
