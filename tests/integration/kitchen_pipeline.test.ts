// @vitest-environment node
// development -> trial -> menu, and the one rule that is easy to get wrong: a dish revised
// AFTER sign-off keeps showing the approved version. The menu must never change under three
// sites because somebody typed in an editor.
import { describe, it, expect, beforeAll } from "vitest";
import { makeUser } from "./helpers";

const stamp = () => Date.now() + Math.floor(Math.random() * 1000);
type Client = Awaited<ReturnType<typeof makeUser>>["client"];
const k = (c: Client) => c.schema("kitchen");

let owner: { id: string; client: Client };
let chef: { id: string; client: Client };
let manager: { id: string; client: Client };
let orgId: string;
let shoreditch: string;

beforeAll(async () => {
  owner = await makeUser(`kitchen-pipe-owner-${stamp()}@t.dev`);
  chef = await makeUser(`kitchen-pipe-chef-${stamp()}@t.dev`);
  manager = await makeUser(`kitchen-pipe-mgr-${stamp()}@t.dev`);
  const { data: org } = await k(owner.client).rpc("create_org", {
    p_name: "Pipeline Group",
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
    ["site_manager", shoreditch, manager, "Mo"],
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

describe("the pipeline", () => {
  it("lets a chef send a dish to one site, and the site then reads it", async () => {
    const { dishId } = await newDish("Trial tart");
    const { error } = await k(chef.client).rpc("send_to_trial", {
      p_dish: dishId,
      p_site: shoreditch,
    });
    expect(error).toBeNull();
    const { data } = await k(manager.client).from("dishes").select("stage").eq("id", dishId);
    expect(data).toEqual([{ stage: "trial" }]);
  });

  it("refuses a site manager who tries to send a dish to trial", async () => {
    const { dishId } = await newDish("Not yours");
    const { error } = await k(manager.client).rpc("send_to_trial", {
      p_dish: dishId,
      p_site: shoreditch,
    });
    expect(error?.code).toBe("KIT01");
  });

  it("refuses a trial at a site belonging to another org", async () => {
    const other = await makeUser(`kitchen-pipe-other-${stamp()}@t.dev`);
    const { data: otherOrg } = await k(other.client).rpc("create_org", {
      p_name: "Other Group",
      p_display_name: "Ona",
    });
    const { data: otherSite } = await k(other.client).rpc("add_site", {
      p_org: otherOrg,
      p_name: "Elsewhere",
    });
    const { dishId } = await newDish("Wrong site");
    const { error } = await k(chef.client).rpc("send_to_trial", {
      p_dish: dishId,
      p_site: otherSite,
    });
    expect(error?.code).toBe("KIT04");
  });

  it("puts a signed-off dish on the menu and clears the trial site", async () => {
    const { dishId, versionId } = await newDish("Menu tart");
    await k(chef.client).rpc("send_to_trial", { p_dish: dishId, p_site: shoreditch });
    const { error } = await k(chef.client).rpc("sign_off", { p_version: versionId });
    expect(error).toBeNull();
    const { data } = await k(manager.client)
      .from("dishes")
      .select("stage,trial_site_id")
      .eq("id", dishId)
      .single();
    expect(data).toEqual({ stage: "menu", trial_site_id: null });
    const { data: live } = await k(manager.client).rpc("menu_version", { p_dish: dishId });
    expect(live).toBe(versionId);
  });

  it("keeps the APPROVED version live when the dish is revised afterwards", async () => {
    const { dishId, versionId } = await newDish("Revised after sign-off");
    await k(chef.client).rpc("send_to_trial", { p_dish: dishId, p_site: shoreditch });
    await k(chef.client).rpc("sign_off", { p_version: versionId });

    const { data: newer } = await k(chef.client).rpc("revise_dish", {
      p_dish: dishId,
      p_note: "more salt",
      p_ingredients: [{ position: 1, quantity: "2", unit: "", item: "onion", section: null }],
      p_steps: [{ position: 1, text: "Cook it longer." }],
    });
    expect(newer).not.toBe(versionId);
    // The newest version is NOT what three sites are cooking.
    const { data: live } = await k(manager.client).rpc("menu_version", { p_dish: dishId });
    expect(live).toBe(versionId);
  });

  it("refuses to sign off a version of a dish still in development", async () => {
    const { versionId } = await newDish("Straight to menu");
    const { error } = await k(chef.client).rpc("sign_off", { p_version: versionId });
    expect(error?.code).toBe("KIT02");
  });
});
