// @vitest-environment node
// Erasing a group. The case that matters most is the one where a dish was PUBLISHED: the
// public recipe row survives on purpose and only its publicity ends, and the delete is only
// allowed at all because the snapshots are cleared before the versions they point at.
import { describe, it, expect } from "vitest";
import { admin, makeUser } from "./helpers";

const stamp = () => Date.now() + Math.floor(Math.random() * 1000);
type Client = Awaited<ReturnType<typeof makeUser>>["client"];
const k = (c: Client) => c.schema("kitchen");

// A fresh group with one owner, one site and one chef, so each case is independent.
async function group(label: string) {
  const owner = await makeUser(`kitchen-erase-owner-${label}-${stamp()}@t.dev`);
  const chef = await makeUser(`kitchen-erase-chef-${label}-${stamp()}@t.dev`);
  const { data: org } = await k(owner.client).rpc("create_org", {
    p_name: `Erase ${label} Group`,
    p_display_name: "Sam",
  });
  const orgId = org as string;
  const { data: site } = await k(owner.client).rpc("add_site", {
    p_org: orgId,
    p_name: "Shoreditch",
  });
  const siteId = site as string;
  const { data: code } = await k(owner.client).rpc("create_invite", {
    p_org: orgId,
    p_role: "chef",
    p_site: null,
  });
  await k(chef.client).rpc("accept_invite", { p_code: code, p_display_name: "Ada" });
  return { owner, chef, orgId, siteId };
}

async function dishOnMenu(orgId: string, siteId: string, chef: Client, title: string) {
  const { data: dish } = await k(chef).rpc("create_dish", { p_org: orgId, p_title: title });
  const { data: version } = await k(chef).rpc("revise_dish", {
    p_dish: dish,
    p_note: "first",
    p_ingredients: [{ position: 1, quantity: "2", unit: "", item: "onions", section: null }],
    p_steps: [{ position: 1, text: "Smoke the onions." }],
  });
  await k(chef).rpc("send_to_trial", { p_dish: dish, p_site: siteId });
  await k(chef).rpc("sign_off", { p_version: version });
  return { dishId: dish as string, versionId: version as string };
}

async function orgStillThere(orgId: string) {
  const { data } = await admin.schema("kitchen").from("orgs").select("id").eq("id", orgId);
  return (data ?? []).length > 0;
}

describe("erasing a group", () => {
  it("erases a group that published, and the public recipe survives as family-only", async () => {
    const { owner, chef, orgId, siteId } = await group("published");
    const { versionId } = await dishOnMenu(orgId, siteId, chef.client, "Smoked onion tart");
    const { data: recipeId, error: pubErr } = await k(owner.client).rpc("publish_dish", {
      p_version: versionId,
    });
    expect(pubErr).toBeNull();

    const { error } = await k(owner.client).rpc("erase_org", { p_org: orgId });
    expect(error).toBeNull();

    // The row survives on purpose; only its publicity ends.
    const { data: recipe } = await admin
      .from("recipes")
      .select("id,visibility")
      .eq("id", recipeId)
      .single();
    expect(recipe).toEqual({ id: recipeId, visibility: "family" });

    for (const table of ["dishes", "sites", "staff"] as const) {
      const { data } = await admin.schema("kitchen").from(table).select("id").eq("org_id", orgId);
      expect(data).toEqual([]);
    }
    expect(await orgStillThere(orgId)).toBe(false);
  });

  it("erases a group that never published", async () => {
    const { owner, orgId } = await group("unpublished");
    const { error } = await k(owner.client).rpc("erase_org", { p_org: orgId });
    expect(error).toBeNull();
    expect(await orgStillThere(orgId)).toBe(false);
  });

  it("erases a group whose dish was already taken down, without raising KIT04", async () => {
    const { owner, chef, orgId, siteId } = await group("taken-down");
    const { dishId, versionId } = await dishOnMenu(orgId, siteId, chef.client, "Gone again");
    await k(owner.client).rpc("publish_dish", { p_version: versionId });
    const { error: downErr } = await k(owner.client).rpc("unpublish_dish", { p_dish: dishId });
    expect(downErr).toBeNull();

    const { error } = await k(owner.client).rpc("erase_org", { p_org: orgId });
    expect(error).toBeNull();
    expect(await orgStillThere(orgId)).toBe(false);
  });

  it("refuses while another owner is still there", async () => {
    const { owner, orgId } = await group("two-owners");
    const second = await makeUser(`kitchen-erase-second-${stamp()}@t.dev`);
    const { data: code } = await k(owner.client).rpc("create_invite", {
      p_org: orgId,
      p_role: "owner",
      p_site: null,
    });
    await k(second.client).rpc("accept_invite", { p_code: code, p_display_name: "Bea" });

    const { error } = await k(owner.client).rpc("erase_org", { p_org: orgId });
    expect(error?.code).toBe("KIT02");
    expect(await orgStillThere(orgId)).toBe(true);
  });

  it("refuses a chef", async () => {
    const { chef, orgId } = await group("chef");
    const { error } = await k(chef.client).rpc("erase_org", { p_org: orgId });
    expect(error?.code).toBe("KIT01");
    expect(await orgStillThere(orgId)).toBe(true);
  });

  it("refuses an unknown group id", async () => {
    const { owner } = await group("unknown");
    const { error } = await k(owner.client).rpc("erase_org", {
      p_org: "00000000-0000-0000-0000-000000000000",
    });
    expect(error?.code).toBe("KIT04");
  });
});
