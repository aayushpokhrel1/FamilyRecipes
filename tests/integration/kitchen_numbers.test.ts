// @vitest-environment node
//
// WHAT THIS FILE PINS: a kitchen group can read its own throughput, and nobody else can.
//
// `kitchen.group_numbers(p_org)` answers an owner or a chef with the dish counts, the funnel
// and a row per site, and answers everybody else with `{}` rather than a partial payload, so
// a site manager, a cook or a stranger calling it over HTTP learns nothing at all.
// `kitchen.my_group_numbers()` answers the same three figures keyed by org id, one key per
// group the caller runs, and `{}` for somebody who runs none.
//
// EVERY FIGURE IS ALL-TIME. There is no window and no "last 30 days" anywhere in these
// numbers, so a test that sets up three dishes is asserting on three dishes and not on three
// dishes since some date.
//
// The functions do not exist yet, so this file is expected to fail until they do.
import { describe, it, expect } from "vitest";
import { makeUser } from "./helpers";

const stamp = () => Date.now() + Math.floor(Math.random() * 1000);
const kitchen = (c: Awaited<ReturnType<typeof makeUser>>["client"]) => c.schema("kitchen");

type Client = Awaited<ReturnType<typeof makeUser>>["client"];

type SiteNumbers = {
  id: string;
  name: string;
  substitutions: number;
  trials: number;
  last_recorded: string | null;
  added: string;
  closed: boolean;
};

type GroupNumbers = {
  dishes: { started: number; landed: number; median_days: number | null; slow: unknown[] };
  funnel: {
    dishes: number;
    with_version: number;
    trialled: number;
    landed: number;
    on_menu: number;
  };
  sites: SiteNumbers[];
};

type StripNumbers = { started: number; landed: number; median_days: number | null };

async function newOrg(owner: Client, name: string) {
  const { data } = await kitchen(owner).rpc("create_org", {
    p_name: name,
    p_display_name: "Sam",
  });
  return data as string;
}

async function newSite(owner: Client, orgId: string, name: string) {
  const { data } = await kitchen(owner).rpc("add_site", { p_org: orgId, p_name: name });
  return data as string;
}

async function newDish(owner: Client, orgId: string, title: string) {
  const { data } = await kitchen(owner).rpc("create_dish", { p_org: orgId, p_title: title });
  return data as string;
}

async function newVersion(owner: Client, dishId: string, note: string) {
  await kitchen(owner).rpc("revise_dish", {
    p_dish: dishId,
    p_note: note,
    p_ingredients: [{ position: 1, item: "water" }],
    p_steps: [{ position: 1, text: "boil it" }],
  });
  const { data: versions } = await kitchen(owner)
    .from("dish_versions")
    .select("id")
    .eq("dish_id", dishId);
  return versions![0].id as string;
}

// Only an owner may mint an invite, so every non-owner role arrives this way.
async function joinAs(owner: Client, orgId: string, role: string, siteId: string | null) {
  const { data: code } = await kitchen(owner).rpc("create_invite", {
    p_org: orgId,
    p_role: role,
    p_site: siteId,
  });
  const joiner = await makeUser(`kit-num-joiner-${stamp()}@t.dev`);
  await kitchen(joiner.client).rpc("accept_invite", { p_code: code, p_display_name: "Ruth" });
  return joiner;
}

describe("the kitchen's own throughput", () => {
  it("an owner sees the group's throughput", async () => {
    const owner = await makeUser(`kit-num-owner-${stamp()}@t.dev`);
    const orgId = await newOrg(owner.client, "Numbers Group");
    const siteId = await newSite(owner.client, orgId, "Bridge Street");

    const first = await newDish(owner.client, orgId, "Soup");
    const second = await newDish(owner.client, orgId, "Stew");
    await newDish(owner.client, orgId, "Bread");

    await newVersion(owner.client, first, "first");
    const secondVersion = await newVersion(owner.client, second, "first");
    await kitchen(owner.client).rpc("send_to_trial", { p_dish: second, p_site: siteId });
    await kitchen(owner.client).rpc("sign_off", { p_version: secondVersion });

    const { data, error } = await kitchen(owner.client).rpc("group_numbers", { p_org: orgId });
    expect(error).toBeNull();
    const numbers = data as unknown as GroupNumbers;
    expect(numbers.dishes.started).toBe(3);
    expect(numbers.dishes.landed).toBe(1);
    expect(numbers.funnel.with_version).toBe(2);
    expect(numbers.funnel.trialled).toBe(1);
  });

  it("a chef sees the same numbers and no people key", async () => {
    const owner = await makeUser(`kit-num-owner-${stamp()}@t.dev`);
    const orgId = await newOrg(owner.client, "Chef Numbers Group");
    const siteId = await newSite(owner.client, orgId, "Bridge Street");

    const first = await newDish(owner.client, orgId, "Soup");
    const second = await newDish(owner.client, orgId, "Stew");
    await newDish(owner.client, orgId, "Bread");
    await newVersion(owner.client, first, "first");
    const secondVersion = await newVersion(owner.client, second, "first");
    await kitchen(owner.client).rpc("send_to_trial", { p_dish: second, p_site: siteId });
    await kitchen(owner.client).rpc("sign_off", { p_version: secondVersion });

    const chef = await joinAs(owner.client, orgId, "chef", null);

    const { data: ownerData } = await kitchen(owner.client).rpc("group_numbers", {
      p_org: orgId,
    });
    const { data, error } = await kitchen(chef.client).rpc("group_numbers", { p_org: orgId });
    expect(error).toBeNull();
    const numbers = data as unknown as GroupNumbers;
    expect(numbers.dishes.started).toBe((ownerData as unknown as GroupNumbers).dishes.started);
    // Absent, not present and empty: the client is never trusted to ignore a key.
    expect(Object.keys(numbers)).not.toContain("people");
  });

  it("a site_manager gets an empty object", async () => {
    const owner = await makeUser(`kit-num-owner-${stamp()}@t.dev`);
    const orgId = await newOrg(owner.client, "Manager Numbers Group");
    const siteId = await newSite(owner.client, orgId, "Bridge Street");
    await newDish(owner.client, orgId, "Soup");
    const manager = await joinAs(owner.client, orgId, "site_manager", siteId);

    const { data, error } = await kitchen(manager.client).rpc("group_numbers", { p_org: orgId });
    expect(error).toBeNull();
    expect(data).toEqual({});
  });

  it("a cook gets an empty object", async () => {
    const owner = await makeUser(`kit-num-owner-${stamp()}@t.dev`);
    const orgId = await newOrg(owner.client, "Cook Numbers Group");
    const siteId = await newSite(owner.client, orgId, "Bridge Street");
    await newDish(owner.client, orgId, "Soup");
    const cook = await joinAs(owner.client, orgId, "cook", siteId);

    const { data, error } = await kitchen(cook.client).rpc("group_numbers", { p_org: orgId });
    expect(error).toBeNull();
    expect(data).toEqual({});
  });

  it("a stranger to the group gets an empty object", async () => {
    const owner = await makeUser(`kit-num-owner-${stamp()}@t.dev`);
    const orgId = await newOrg(owner.client, "Stranger Numbers Group");
    await newDish(owner.client, orgId, "Soup");
    const stranger = await makeUser(`kit-num-stranger-${stamp()}@t.dev`);

    const { data, error } = await kitchen(stranger.client).rpc("group_numbers", { p_org: orgId });
    expect(error).toBeNull();
    expect(data).toEqual({});
  });

  it("a dish with no versions counts as started and is not in the median", async () => {
    const owner = await makeUser(`kit-num-owner-${stamp()}@t.dev`);
    const orgId = await newOrg(owner.client, "Median Numbers Group");
    const siteId = await newSite(owner.client, orgId, "Bridge Street");

    const versioned = await newDish(owner.client, orgId, "Soup");
    await newDish(owner.client, orgId, "Bread");
    const versionId = await newVersion(owner.client, versioned, "first");
    await kitchen(owner.client).rpc("send_to_trial", { p_dish: versioned, p_site: siteId });
    await kitchen(owner.client).rpc("sign_off", { p_version: versionId });

    const { data, error } = await kitchen(owner.client).rpc("group_numbers", { p_org: orgId });
    expect(error).toBeNull();
    const numbers = data as unknown as GroupNumbers;
    expect(numbers.dishes.started).toBe(2);
    expect(numbers.dishes.landed).toBe(1);
    // The versionless dish is excluded from the median rather than counted as zero days.
    expect(numbers.dishes.median_days).toBe(0);
  });

  it("an empty group returns a null median and no error", async () => {
    const owner = await makeUser(`kit-num-owner-${stamp()}@t.dev`);
    const orgId = await newOrg(owner.client, "Empty Numbers Group");

    const { data, error } = await kitchen(owner.client).rpc("group_numbers", { p_org: orgId });
    expect(error).toBeNull();
    const numbers = data as unknown as GroupNumbers;
    expect(numbers.dishes.median_days).toBeNull();
    expect(numbers.funnel.dishes).toBe(0);
  });

  it("a site with nothing recorded reports null last_recorded", async () => {
    const owner = await makeUser(`kit-num-owner-${stamp()}@t.dev`);
    const orgId = await newOrg(owner.client, "Quiet Site Group");
    const siteId = await newSite(owner.client, orgId, "Bridge Street");

    const { data, error } = await kitchen(owner.client).rpc("group_numbers", { p_org: orgId });
    expect(error).toBeNull();
    const numbers = data as unknown as GroupNumbers;
    const site = numbers.sites.find((s) => s.id === siteId)!;
    expect(site.substitutions).toBe(0);
    expect(site.trials).toBe(0);
    expect(site.last_recorded).toBeNull();
    expect(typeof site.added).toBe("string");
    expect(site.added.length).toBeGreaterThan(0);
  });

  it("a site that has recorded a substitution reports when", async () => {
    const owner = await makeUser(`kit-num-owner-${stamp()}@t.dev`);
    const orgId = await newOrg(owner.client, "Substitution Group");
    const siteId = await newSite(owner.client, orgId, "Bridge Street");
    const dishId = await newDish(owner.client, orgId, "Soup");
    await kitchen(owner.client).rpc("record_deviation", {
      p_dish: dishId,
      p_site: siteId,
      p_note: "less salt",
    });

    const { data, error } = await kitchen(owner.client).rpc("group_numbers", { p_org: orgId });
    expect(error).toBeNull();
    const numbers = data as unknown as GroupNumbers;
    const site = numbers.sites.find((s) => s.id === siteId)!;
    expect(site.substitutions).toBe(1);
    expect(site.last_recorded).not.toBeNull();
  });

  it("my_group_numbers returns a key per group the caller runs", async () => {
    const owner = await makeUser(`kit-num-owner-${stamp()}@t.dev`);
    const firstOrg = await newOrg(owner.client, "First Numbers Group");
    const secondOrg = await newOrg(owner.client, "Second Numbers Group");
    await newDish(owner.client, firstOrg, "Soup");
    await newDish(owner.client, secondOrg, "Stew");

    const { data, error } = await kitchen(owner.client).rpc("my_group_numbers");
    expect(error).toBeNull();
    const strip = data as unknown as Record<string, StripNumbers>;
    expect(Object.keys(strip).length).toBe(2);
    expect(Object.keys(strip)).toContain(firstOrg);
    expect(Object.keys(strip)).toContain(secondOrg);
  });

  it("my_group_numbers is empty for somebody who runs nothing", async () => {
    const fresh = await makeUser(`kit-num-fresh-${stamp()}@t.dev`);

    const { data, error } = await kitchen(fresh.client).rpc("my_group_numbers");
    expect(error).toBeNull();
    expect(data).toEqual({});
  });
});
