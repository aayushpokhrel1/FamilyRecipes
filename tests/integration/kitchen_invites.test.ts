// @vitest-environment node
// Joining an org by link. peek_invite exists so the page can NAME the org and the role
// before anyone signs in, and accept_invite is separate so a forwarded link cannot make
// somebody a chef by being opened. The family app learned both halves the hard way.
import { describe, it, expect } from "vitest";
import { admin, anonClient, makeUser } from "./helpers";

const stamp = () => Date.now() + Math.floor(Math.random() * 1000);

type Client = Awaited<ReturnType<typeof makeUser>>["client"];
const k = (c: Client) => c.schema("kitchen");

async function orgWithOwner(tag: string) {
  const owner = await makeUser(`kitchen-inv-${tag}-${stamp()}@t.dev`);
  const { data: orgId } = await k(owner.client).rpc("create_org", {
    p_name: "Invite Group",
    p_display_name: "Sam",
  });
  return { owner, orgId: orgId as string };
}

describe("staff invites", () => {
  it("names the org and the role to a stranger who is not signed in", async () => {
    const { owner, orgId } = await orgWithOwner("peek");
    const { data: siteId } = await k(owner.client)
      .rpc("add_site", { p_org: orgId, p_name: "Shoreditch" });
    const { data: code } = await k(owner.client)
      .rpc("create_invite", {
        p_org: orgId,
        p_role: "site_manager",
        p_site: siteId,
      });

    const { data, error } = await anonClient()
      .schema("kitchen")
      .rpc("peek_invite", { p_code: code });
    expect(error).toBeNull();
    expect(data).toEqual([
      { org_name: "Invite Group", role: "site_manager", site_name: "Shoreditch" },
    ]);
  });

  it("adds the staff row only when the invite is accepted", async () => {
    const { owner, orgId } = await orgWithOwner("accept");
    const { data: code } = await k(owner.client)
      .rpc("create_invite", { p_org: orgId, p_role: "chef", p_site: null });

    const joiner = await makeUser(`kitchen-joiner-${stamp()}@t.dev`);
    // Peeking changes nothing: a forwarded link must not employ anybody.
    await k(joiner.client).schema("kitchen").rpc("peek_invite", { p_code: code });
    const { data: before } = await admin
      .schema("kitchen")
      .from("staff")
      .select("user_id")
      .eq("org_id", orgId)
      .eq("user_id", joiner.id);
    expect(before).toEqual([]);

    const { data: joined, error } = await k(joiner.client)
      .schema("kitchen")
      .rpc("accept_invite", { p_code: code, p_display_name: "Ada" });
    expect(error).toBeNull();
    expect(joined).toBe(orgId);

    const { data: after } = await admin
      .schema("kitchen")
      .from("staff")
      .select("role,display_name")
      .eq("org_id", orgId)
      .eq("user_id", joiner.id)
      .single();
    expect(after).toEqual({ role: "chef", display_name: "Ada" });
  });

  it("refuses a code twice", async () => {
    const { owner, orgId } = await orgWithOwner("once");
    const { data: code } = await k(owner.client)
      .rpc("create_invite", { p_org: orgId, p_role: "cook", p_site: null });
    const first = await makeUser(`kitchen-first-${stamp()}@t.dev`);
    const second = await makeUser(`kitchen-second-${stamp()}@t.dev`);

    await k(first.client)
      .schema("kitchen")
      .rpc("accept_invite", { p_code: code, p_display_name: "One" });
    const { error } = await k(second.client)
      .schema("kitchen")
      .rpc("accept_invite", { p_code: code, p_display_name: "Two" });
    expect(error?.code).toBe("KIT04");
  });

  it("refuses to let a chef mint an invite", async () => {
    const { owner, orgId } = await orgWithOwner("mint");
    const { data: code } = await k(owner.client)
      .rpc("create_invite", { p_org: orgId, p_role: "chef", p_site: null });
    const chef = await makeUser(`kitchen-chef-${stamp()}@t.dev`);
    await k(chef.client)
      .schema("kitchen")
      .rpc("accept_invite", { p_code: code, p_display_name: "Ada" });

    const { error } = await k(chef.client)
      .schema("kitchen")
      .rpc("create_invite", { p_org: orgId, p_role: "owner", p_site: null });
    expect(error?.code).toBe("KIT01");
  });
});
