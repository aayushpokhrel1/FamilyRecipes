// @vitest-environment node
// The read ladder, which is the product's security model: four roles times three stages.
// A cook at the wrong site reading a dish in development is the bug that would kill this
// product with its first customer, so it is pinned here rather than in a doc.
import { describe, it, expect, beforeAll } from "vitest";
import { makeUser } from "./helpers";

const stamp = () => Date.now() + Math.floor(Math.random() * 1000);
type Client = Awaited<ReturnType<typeof makeUser>>["client"];
const k = (c: Client) => c.schema("kitchen");

let owner: { id: string; client: Client };
let chef: { id: string; client: Client };
let shoreditchManager: { id: string; client: Client };
let otherSiteCook: { id: string; client: Client };
let groupWideCook: { id: string; client: Client };
let orgId: string;
let shoreditch: string;
let peckham: string;
let dishId: string;
async function invite(role: string, site: string | null, who: { client: Client }, name: string) {
  const { data: code } = await k(owner.client).rpc("create_invite", {
    p_org: orgId,
    p_role: role,
    p_site: site,
  });
  await k(who.client).rpc("accept_invite", { p_code: code, p_display_name: name });
}

beforeAll(async () => {
  owner = await makeUser(`kitchen-ladder-owner-${stamp()}@t.dev`);
  chef = await makeUser(`kitchen-ladder-chef-${stamp()}@t.dev`);
  shoreditchManager = await makeUser(`kitchen-ladder-mgr-${stamp()}@t.dev`);
  otherSiteCook = await makeUser(`kitchen-ladder-cook-${stamp()}@t.dev`);
  groupWideCook = await makeUser(`kitchen-ladder-gcook-${stamp()}@t.dev`);

  const { data: org } = await k(owner.client).rpc("create_org", {
    p_name: "Ladder Group",
    p_display_name: "Sam",
  });
  orgId = org as string;
  const { data: a } = await k(owner.client).rpc("add_site", { p_org: orgId, p_name: "Shoreditch" });
  const { data: b } = await k(owner.client).rpc("add_site", { p_org: orgId, p_name: "Peckham" });
  shoreditch = a as string;
  peckham = b as string;

  await invite("chef", null, chef, "Ada");
  await invite("site_manager", shoreditch, shoreditchManager, "Mo");
  await invite("cook", peckham, otherSiteCook, "Kit");
  await invite("cook", null, groupWideCook, "No-site");

  const { data: dish } = await k(chef.client).rpc("create_dish", {
    p_org: orgId,
    p_title: "Smoked onion tart",
  });
  dishId = dish as string;
  await k(chef.client).rpc("revise_dish", {
    p_dish: dishId,
    p_note: "first pass",
    p_ingredients: [{ position: 1, quantity: "2", unit: "", item: "onions", section: null }],
    p_steps: [{ position: 1, text: "Smoke the onions." }],
  });
});
async function canRead(who: { client: Client }) {
  const { data } = await k(who.client).from("dishes").select("id").eq("id", dishId);
  return (data ?? []).length === 1;
}

describe("a dish in development", () => {
  it("is readable by the chef who made it and by the owner", async () => {
    expect(await canRead(chef)).toBe(true);
    expect(await canRead(owner)).toBe(true);
  });

  it("is invisible to a site manager and to every cook", async () => {
    expect(await canRead(shoreditchManager)).toBe(false);
    expect(await canRead(otherSiteCook)).toBe(false);
    expect(await canRead(groupWideCook)).toBe(false);
  });

  it("hides its ingredients and steps too, not just its title", async () => {
    const { data: versions } = await k(otherSiteCook.client).from("dish_versions").select("id");
    expect(versions).toEqual([]);
    const { data: ing } = await k(otherSiteCook.client).from("dish_ingredients").select("id");
    expect(ing).toEqual([]);
  });

  it("is invisible to someone in no org at all", async () => {
    const outsider = await makeUser(`kitchen-ladder-out-${stamp()}@t.dev`);
    expect(await canRead(outsider)).toBe(false);
  });

  it("keeps the version immutable: there is no door to edit one", async () => {
    const { data: v } = await k(chef.client).from("dish_versions").select("id").limit(1).single();
    const { error } = await k(chef.client)
      .from("dish_versions")
      .update({ note: "rewritten" })
      .eq("id", v!.id);
    // No update policy exists, so this changes nothing. Revising writes a NEW version, which
    // is what makes "who changed what and why" answerable at all.
    const { data: after } = await k(chef.client)
      .from("dish_versions")
      .select("note")
      .eq("id", v!.id)
      .single();
    expect(after!.note).toBe("first pass");
    // Deliberately NOT asserting on `error`. With no update policy the statement matches no
    // rows and PostgREST reports success, so an error assertion here would either be a
    // tautology or would pin the wrong mechanism. The unchanged note is the whole proof.
    expect(error).toBeNull();
  });
});