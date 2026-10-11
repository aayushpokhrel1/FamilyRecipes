// @vitest-environment node
// The kitchen schema at the database level. Every call goes through the caller's own client
// with their own JWT, because the point of each test is what the CALLER may do.
import { describe, it, expect } from "vitest";
import { admin, makeUser } from "./helpers";

const stamp = () => Date.now() + Math.floor(Math.random() * 1000);
const kitchen = (c: Awaited<ReturnType<typeof makeUser>>["client"]) => c.schema("kitchen");

describe("an org and its owner", () => {
  it("is reachable at all, which the hosted project needs a manual setting for", async () => {
    // If this fails with a 404 or "schema must be one of", the schema is not exposed:
    // locally add it to supabase/config.toml, on the hosted project set it in
    // Settings -> API -> Exposed schemas BY HAND. No migration does it.
    const chef = await makeUser(`kitchen-reach-${stamp()}@t.dev`);
    const { error } = await kitchen(chef.client).from("orgs").select("id").limit(1);
    expect(error).toBeNull();
  });

  it("creates the org and the owner staff row in one call", async () => {
    const owner = await makeUser(`kitchen-owner-${stamp()}@t.dev`);
    const { data: orgId, error } = await owner.client
      .schema("kitchen")
      .rpc("create_org", { p_name: "Enamel Group", p_display_name: "Sam" });
    expect(error).toBeNull();
    expect(orgId).toBeTruthy();

    const { data: staff } = await admin
      .schema("kitchen")
      .from("staff")
      .select("role,display_name,site_id")
      .eq("org_id", orgId)
      .eq("user_id", owner.id)
      .single();
    // Owner, group-wide (no site), named. An org whose creator is not its owner cannot be
    // administered by anyone, which is the 0032 lesson applied to a second product.
    expect(staff).toEqual({ role: "owner", display_name: "Sam", site_id: null });
  });

  it("hides an org from someone who is not its staff", async () => {
    const owner = await makeUser(`kitchen-hide-a-${stamp()}@t.dev`);
    const stranger = await makeUser(`kitchen-hide-b-${stamp()}@t.dev`);
    await kitchen(owner.client).rpc("create_org", {
      p_name: "Private Group",
      p_display_name: "Sam",
    });
    const { data } = await kitchen(stranger.client).from("orgs").select("id");
    expect(data).toEqual([]);
  });

  it("lets an owner name a site and refuses a stranger", async () => {
    const owner = await makeUser(`kitchen-site-a-${stamp()}@t.dev`);
    const stranger = await makeUser(`kitchen-site-b-${stamp()}@t.dev`);
    const { data: orgId } = await kitchen(owner.client).rpc("create_org", {
      p_name: "Two Site Group",
      p_display_name: "Sam",
    });

    const { data: siteId, error } = await kitchen(owner.client).rpc("add_site", {
      p_org: orgId,
      p_name: "Shoreditch",
    });
    expect(error).toBeNull();
    expect(siteId).toBeTruthy();

    const { error: refused } = await kitchen(stranger.client).rpc("add_site", {
      p_org: orgId,
      p_name: "Not mine",
    });
    expect(refused?.code).toBe("KIT01");
  });
});