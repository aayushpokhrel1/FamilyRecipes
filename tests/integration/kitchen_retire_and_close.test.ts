// @vitest-environment node
// Retiring a dish and closing a site, and the two things that are easy to get wrong: a
// retired dish still publishes (retirement is about the group's menu, publication is about
// the public), and closing a site moves its trials home BEFORE it stamps closed_at, because
// trial_site_iff_trial ties stage and site together.
import { describe, it, expect, beforeAll } from "vitest";
import { admin, makeUser } from "./helpers";

const stamp = () => Date.now() + Math.floor(Math.random() * 1000);
type Client = Awaited<ReturnType<typeof makeUser>>["client"];
const k = (c: Client) => c.schema("kitchen");

let owner: { id: string; client: Client };
let chef: { id: string; client: Client };
let cook: { id: string; client: Client };
let orgId: string;
let shoreditch: string;

beforeAll(async () => {
  owner = await makeUser(`kitchen-retire-owner-${stamp()}@t.dev`);
  chef = await makeUser(`kitchen-retire-chef-${stamp()}@t.dev`);
  cook = await makeUser(`kitchen-retire-cook-${stamp()}@t.dev`);
  const { data: org } = await k(owner.client).rpc("create_org", {
    p_name: "Retirement Group",
    p_display_name: "Sam",
  });
  orgId = org as string;
  const { data: site } = await k(owner.client).rpc("add_site", {
    p_org: orgId,
    p_name: "Shoreditch",
  });
  shoreditch = site as string;
  for (const [role, site_id, who, name] of [
    ["chef", null, chef, "Ada"],
    ["cook", shoreditch, cook, "Mo"],
  ] as const) {
    const { data: code } = await k(owner.client).rpc("create_invite", {
      p_org: orgId,
      p_role: role,
      p_site: site_id,
    });
    await k(who.client).rpc("accept_invite", { p_code: code, p_display_name: name });
  }
});

async function newDish(title: string) {
  const { data: dish } = await k(chef.client).rpc("create_dish", { p_org: orgId, p_title: title });
  const { data: version } = await k(chef.client).rpc("revise_dish", {
    p_dish: dish,
    p_note: "first",
    p_ingredients: [{ position: 1, quantity: "1", unit: "", item: "onion", section: null }],
    p_steps: [{ position: 1, text: "Cook it." }],
  });
  return { dishId: dish as string, versionId: version as string };
}

describe("retiring a dish", () => {
  it("stops a retired dish going to trial", async () => {
    const { dishId } = await newDish("Retired tart");
    const { error: retired } = await k(chef.client).rpc("retire_dish", { p_dish: dishId });
    expect(retired).toBeNull();
    const { error } = await k(chef.client).rpc("send_to_trial", {
      p_dish: dishId,
      p_site: shoreditch,
    });
    expect(error?.code).toBe("KIT02");
  });

  it("stops a retired dish being signed off", async () => {
    const { dishId, versionId } = await newDish("Retired at trial");
    await k(chef.client).rpc("send_to_trial", { p_dish: dishId, p_site: shoreditch });
    await k(chef.client).rpc("retire_dish", { p_dish: dishId });
    const { error } = await k(chef.client).rpc("sign_off", { p_version: versionId });
    expect(error?.code).toBe("KIT02");
  });

  it("refuses to retire a dish that is already retired", async () => {
    const { dishId } = await newDish("Twice retired");
    await k(chef.client).rpc("retire_dish", { p_dish: dishId });
    const { error } = await k(chef.client).rpc("retire_dish", { p_dish: dishId });
    expect(error?.code).toBe("KIT02");
  });

  it("refuses a cook, who may not retire a dish", async () => {
    const { dishId } = await newDish("Not yours to retire");
    const { error } = await k(cook.client).rpc("retire_dish", { p_dish: dishId });
    expect(error?.code).toBe("KIT01");
  });

  it("lets an unretired dish go to trial again", async () => {
    const { dishId } = await newDish("Back on the menu");
    await k(chef.client).rpc("retire_dish", { p_dish: dishId });
    const { error: unretired } = await k(chef.client).rpc("unretire_dish", { p_dish: dishId });
    expect(unretired).toBeNull();
    const { error } = await k(chef.client).rpc("send_to_trial", {
      p_dish: dishId,
      p_site: shoreditch,
    });
    expect(error).toBeNull();
  });

  it("still publishes a signed-off version of a RETIRED dish", async () => {
    // Publication is about the public, retirement is about the group's own menu. They are
    // separate axes on purpose, so this must succeed.
    const { dishId, versionId } = await newDish("Retired but public");
    await k(chef.client).rpc("send_to_trial", { p_dish: dishId, p_site: shoreditch });
    await k(chef.client).rpc("sign_off", { p_version: versionId });
    await k(chef.client).rpc("retire_dish", { p_dish: dishId });
    const { error } = await k(owner.client).rpc("publish_dish", { p_version: versionId });
    expect(error).toBeNull();
  });
});

describe("closing a site", () => {
  it("moves a trial dish home before the site closes", async () => {
    const { data: site } = await k(owner.client).rpc("add_site", {
      p_org: orgId,
      p_name: "Brixton",
    });
    const { dishId } = await newDish("Out at Brixton");
    await k(chef.client).rpc("send_to_trial", { p_dish: dishId, p_site: site });
    const { error } = await k(owner.client).rpc("close_site", { p_site: site });
    expect(error).toBeNull();
    const { data } = await admin
      .schema("kitchen")
      .from("dishes")
      .select("stage,trial_site_id")
      .eq("id", dishId)
      .single();
    expect(data).toEqual({ stage: "development", trial_site_id: null });
  });

  it("nulls a cook's site but leaves a chef's alone", async () => {
    const { data: site } = await k(owner.client).rpc("add_site", {
      p_org: orgId,
      p_name: "Camden",
    });
    const { data: code } = await k(owner.client).rpc("create_invite", {
      p_org: orgId,
      p_role: "cook",
      p_site: site,
    });
    const camdenCook = await makeUser(`kitchen-retire-camden-${stamp()}@t.dev`);
    await k(camdenCook.client).rpc("accept_invite", { p_code: code, p_display_name: "Kit" });

    const { error } = await k(owner.client).rpc("close_site", { p_site: site });
    expect(error).toBeNull();

    const { data: staff } = await admin
      .schema("kitchen")
      .from("staff")
      .select("user_id,role,site_id")
      .eq("org_id", orgId)
      .in("user_id", [camdenCook.id, chef.id]);
    const byUser = Object.fromEntries(staff!.map((s) => [s.user_id, s]));
    expect(byUser[camdenCook.id]).toEqual({ user_id: camdenCook.id, role: "cook", site_id: null });
    // A chef is group-wide, so closing a site says nothing about their row.
    expect(byUser[chef.id]).toEqual({ user_id: chef.id, role: "chef", site_id: null });
  });

  it("refuses a chef, because closing a site speaks for the business", async () => {
    const { data: site } = await k(owner.client).rpc("add_site", {
      p_org: orgId,
      p_name: "Peckham",
    });
    const { error } = await k(chef.client).rpc("close_site", { p_site: site });
    expect(error?.code).toBe("KIT01");
  });

  it("refuses to close a site that is already closed", async () => {
    const { data: site } = await k(owner.client).rpc("add_site", {
      p_org: orgId,
      p_name: "Hackney",
    });
    await k(owner.client).rpc("close_site", { p_site: site });
    const { error } = await k(owner.client).rpc("close_site", { p_site: site });
    expect(error?.code).toBe("KIT02");
  });
});
