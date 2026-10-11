// @vitest-environment node
// The ONE function that crosses the seal. The interesting assertion is the byline: a
// published dish carries the VENUE's name and no person's handle, which works because the
// snapshot hangs off a families row with no members at all.
import { describe, it, expect, beforeAll } from "vitest";
import { admin, anonClient, makeUser } from "./helpers";

const stamp = () => Date.now() + Math.floor(Math.random() * 1000);
type Client = Awaited<ReturnType<typeof makeUser>>["client"];
const k = (c: Client) => c.schema("kitchen");

let owner: { id: string; client: Client };
let chef: { id: string; client: Client };
let orgId: string;
let shoreditch: string;

beforeAll(async () => {
  owner = await makeUser(`kitchen-pub-owner-${stamp()}@t.dev`);
  chef = await makeUser(`kitchen-pub-chef-${stamp()}@t.dev`);
  const { data: org } = await k(owner.client).rpc("create_org", {
    p_name: "Enamel Vault Group",
    p_display_name: "Sam",
  });
  orgId = org as string;
  const { data: site } = await k(owner.client).rpc("add_site", {
    p_org: orgId,
    p_name: "Shoreditch",
  });
  shoreditch = site as string;
  const { data: code } = await k(owner.client).rpc("create_invite", {
    p_org: orgId,
    p_role: "chef",
    p_site: null,
  });
  await k(chef.client).rpc("accept_invite", { p_code: code, p_display_name: "Ada" });
});

async function dishOnMenu(title: string) {
  const { data: dish } = await k(chef.client).rpc("create_dish", { p_org: orgId, p_title: title });
  const { data: version } = await k(chef.client).rpc("revise_dish", {
    p_dish: dish,
    p_note: "first",
    p_ingredients: [{ position: 1, quantity: "2", unit: "", item: "onions", section: null }],
    p_steps: [{ position: 1, text: "Smoke the onions." }],
  });
  await k(chef.client).rpc("send_to_trial", { p_dish: dish, p_site: shoreditch });
  await k(chef.client).rpc("sign_off", { p_version: version });
  return { dishId: dish as string, versionId: version as string };
}

describe("publishing a dish out to Potluck", () => {
  it("refuses a chef, because publishing speaks for the business", async () => {
    const { versionId } = await dishOnMenu("Chef cannot publish");
    const { error } = await k(chef.client).rpc("publish_dish", { p_version: versionId });
    expect(error?.code).toBe("KIT01");
  });

  it("puts the dish in Potluck with the VENUE as the byline and no handle", async () => {
    const { versionId } = await dishOnMenu("Smoked onion tart");
    const { data: recipeId, error } = await k(owner.client).rpc("publish_dish", {
      p_version: versionId,
    });
    expect(error).toBeNull();

    // A stranger with no session: the whole point of publishing.
    const stranger = anonClient();
    const { data: recipe } = await stranger
      .from("recipes")
      .select("title,visibility")
      .eq("id", recipeId)
      .single();
    expect(recipe).toEqual({ title: "Smoked onion tart", visibility: "public" });

    const { data: byline } = await stranger
      .from("public_recipe_bylines")
      .select("handle,public_name,family_name")
      .eq("recipe_id", recipeId)
      .single();
    expect(byline).toEqual({
      handle: null,
      public_name: null,
      family_name: "Enamel Vault Group",
    });

    const { data: ing } = await stranger
      .from("recipe_ingredients")
      .select("item")
      .eq("recipe_id", recipeId);
    expect(ing).toEqual([{ item: "onions" }]);
  });

  it("keeps the venue family members-free, so nobody can write into it", async () => {
    const { versionId } = await dishOnMenu("Members free");
    const { data: recipeId } = await k(owner.client).rpc("publish_dish", { p_version: versionId });
    const { data: snap } = await admin
      .schema("kitchen")
      .from("published_snapshots")
      .select("venue_family_id")
      .eq("recipe_id", recipeId)
      .single();
    const { data: members } = await admin
      .from("family_members")
      .select("user_id")
      .eq("family_id", snap!.venue_family_id);
    expect(members).toEqual([]);
  });

  it("re-publishing keeps the same public URL", async () => {
    const { dishId, versionId } = await dishOnMenu("Same URL");
    const { data: first } = await k(owner.client).rpc("publish_dish", { p_version: versionId });
    const { data: newer } = await k(chef.client).rpc("revise_dish", {
      p_dish: dishId,
      p_note: "more salt",
      p_ingredients: [{ position: 1, quantity: "3", unit: "", item: "onions", section: null }],
      p_steps: [{ position: 1, text: "Smoke them longer." }],
    });
    await k(chef.client).rpc("sign_off", { p_version: newer });
    const { data: second } = await k(owner.client).rpc("publish_dish", { p_version: newer });
    expect(second).toBe(first);
    const { data: ing } = await anonClient()
      .from("recipe_ingredients")
      .select("quantity")
      .eq("recipe_id", first);
    expect(ing).toEqual([{ quantity: "3" }]);
  });

  it("unpublishing leaves it readable by nobody at all", async () => {
    const { dishId, versionId } = await dishOnMenu("Gone again");
    const { data: recipeId } = await k(owner.client).rpc("publish_dish", { p_version: versionId });
    await k(owner.client).rpc("unpublish_dish", { p_dish: dishId });
    const { data } = await anonClient().from("recipes").select("id").eq("id", recipeId);
    expect(data).toEqual([]);
    const { data: alsoOwner } = await owner.client.from("recipes").select("id").eq("id", recipeId);
    expect(alsoOwner).toEqual([]);
  });

  it("cannot republish a dish whose snapshot was taken down by a moderator", async () => {
    const { dishId, versionId } = await dishOnMenu("Taken down");
    const { data: recipeId } = await k(owner.client).rpc("publish_dish", { p_version: versionId });
    // What a moderator's takedown does, applied directly: removed_at set, no longer public.
    await admin
      .from("recipes")
      .update({ removed_at: new Date().toISOString(), visibility: "family" })
      .eq("id", recipeId);
    const { error } = await k(owner.client).rpc("publish_dish", { p_version: versionId });
    expect(error).not.toBeNull();
  });

  it("refuses to publish a version nobody signed off", async () => {
    const { data: dish } = await k(chef.client).rpc("create_dish", {
      p_org: orgId,
      p_title: "Unapproved",
    });
    const { data: version } = await k(chef.client).rpc("revise_dish", {
      p_dish: dish,
      p_note: "draft",
      p_ingredients: [],
      p_steps: [],
    });
    const { error } = await k(owner.client).rpc("publish_dish", { p_version: version });
    expect(error?.code).toBe("KIT03");
  });
});
