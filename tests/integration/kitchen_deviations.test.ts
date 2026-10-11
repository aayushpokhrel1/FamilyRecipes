// @vitest-environment node
// A site that has to change something records it AGAINST the group version rather than
// replacing it, so the chef can see that one site is cooking it differently. A site manager
// may only speak for their own site, which is the one role rule here that is not obvious.
import { describe, it, expect, beforeAll } from "vitest";
import { makeUser } from "./helpers";

const stamp = () => Date.now() + Math.floor(Math.random() * 1000);
type Client = Awaited<ReturnType<typeof makeUser>>["client"];
const k = (c: Client) => c.schema("kitchen");

let owner: { id: string; client: Client };
let chef: { id: string; client: Client };
let shoreditchManager: { id: string; client: Client };
let orgId: string;
let shoreditch: string;
let peckham: string;
let dishId: string;

beforeAll(async () => {
  owner = await makeUser(`kitchen-dev-owner-${stamp()}@t.dev`);
  chef = await makeUser(`kitchen-dev-chef-${stamp()}@t.dev`);
  shoreditchManager = await makeUser(`kitchen-dev-mgr-${stamp()}@t.dev`);
  const { data: org } = await k(owner.client).rpc("create_org", {
    p_name: "Deviation Group",
    p_display_name: "Sam",
  });
  orgId = org as string;
  const { data: a } = await k(owner.client).rpc("add_site", { p_org: orgId, p_name: "Shoreditch" });
  const { data: b } = await k(owner.client).rpc("add_site", { p_org: orgId, p_name: "Peckham" });
  shoreditch = a as string;
  peckham = b as string;
  for (const [role, site_id, who, name] of [
    ["chef", null, chef, "Ada"],
    ["site_manager", shoreditch, shoreditchManager, "Mo"],
  ] as const) {
    const { data: code } = await k(owner.client).rpc("create_invite", {
      p_org: orgId,
      p_role: role,
      p_site: site_id,
    });
    await k(who.client).rpc("accept_invite", { p_code: code, p_display_name: name });
  }
  const { data: dish } = await k(chef.client).rpc("create_dish", {
    p_org: orgId,
    p_title: "Group tart",
  });
  dishId = dish as string;
  const { data: version } = await k(chef.client).rpc("revise_dish", {
    p_dish: dishId,
    p_note: "first",
    p_ingredients: [{ position: 1, quantity: "1", unit: "", item: "comté", section: null }],
    p_steps: [{ position: 1, text: "Grate the cheese." }],
  });
  await k(chef.client).rpc("send_to_trial", { p_dish: dishId, p_site: shoreditch });
  await k(chef.client).rpc("sign_off", { p_version: version });
});

describe("deviations", () => {
  it("lets a site manager record one for their own site, and the chef can read it", async () => {
    const { error } = await k(shoreditchManager.client).rpc("record_deviation", {
      p_dish: dishId,
      p_site: shoreditch,
      p_note: "Cheddar: no comté from our supplier.",
    });
    expect(error).toBeNull();
    const { data } = await k(chef.client)
      .from("deviations")
      .select("site_id,note")
      .eq("dish_id", dishId);
    expect(data).toEqual([
      { site_id: shoreditch, note: "Cheddar: no comté from our supplier." },
    ]);
  });

  it("refuses a site manager speaking for another site", async () => {
    const { error } = await k(shoreditchManager.client).rpc("record_deviation", {
      p_dish: dishId,
      p_site: peckham,
      p_note: "Not my site.",
    });
    expect(error?.code).toBe("KIT01");
  });

  it("leaves the group version untouched", async () => {
    const { data: ing } = await k(chef.client)
      .from("dish_ingredients")
      .select("item")
      .order("position");
    expect(ing!.some((r) => r.item === "comté")).toBe(true);
    expect(ing!.some((r) => r.item === "cheddar")).toBe(false);
  });
});
