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

// 0054. 0040's gates all fail closed, so none of them was the 0049 shape. What it lacked was
// any rule about what an invite MEANS once it exists, and these are the three.
describe("what an invite stops meaning", () => {
  // An invite in an old email or a forwarded chat employed its bearer for ever: used_at made
  // a code single-use and nothing made it short-lived. There is no revocation either (the
  // table has a select policy and no delete policy), so the lifetime is the only control.
  it("refuses an expired code, and does not name the kitchen to a stranger holding one", async () => {
    const { owner, orgId } = await orgWithOwner("expired");
    const { data: code } = await k(owner.client)
      .rpc("create_invite", { p_org: orgId, p_role: "cook", p_site: null });
    // Aged with admin rather than by waiting: the rule under test is the comparison against
    // now(), and a test that sleeps for a week is not a test.
    await admin.schema("kitchen").from("staff_invites")
      .update({ expires_at: new Date(Date.now() - 1000).toISOString() })
      .eq("code", code);

    const peeked = await anonClient().schema("kitchen").rpc("peek_invite", { p_code: code });
    expect(peeked.error).toBeNull();
    expect(peeked.data).toEqual([]);

    const joiner = await makeUser(`kitchen-expired-j-${stamp()}@t.dev`);
    const { error } = await k(joiner.client)
      .rpc("accept_invite", { p_code: code, p_display_name: "Late" });
    expect(error?.code).toBe("KIT04");
    const { data: staff } = await admin.schema("kitchen").from("staff")
      .select("user_id").eq("org_id", orgId).eq("user_id", joiner.id);
    expect(staff).toEqual([]);
  });

  // THE DIRECTION IS THE WHOLE POINT, and it is the one 0049's HIGH came from: offboarding
  // must REDUCE what someone can do. create_invite checks ownership when the link is minted
  // and nothing re-checked it when the link was used, so a removed owner's outstanding links
  // went on employing people, up to and including as another owner.
  it("refuses an invite whose sender is no longer an owner", async () => {
    const { owner, orgId } = await orgWithOwner("exowner");
    // A second owner, so removing the first leaves the org with one and the test is about
    // the invite rather than about an org with nobody in charge.
    const { data: coCode } = await k(owner.client)
      .rpc("create_invite", { p_org: orgId, p_role: "owner", p_site: null });
    const co = await makeUser(`kitchen-exowner-co-${stamp()}@t.dev`);
    await k(co.client).rpc("accept_invite", { p_code: coCode, p_display_name: "Co" });

    const { data: code } = await k(co.client)
      .rpc("create_invite", { p_org: orgId, p_role: "owner", p_site: null });
    // The sender is offboarded AFTER minting it.
    await admin.schema("kitchen").from("staff")
      .delete().eq("org_id", orgId).eq("user_id", co.id);

    const confederate = await makeUser(`kitchen-exowner-x-${stamp()}@t.dev`);
    const { error } = await k(confederate.client)
      .rpc("accept_invite", { p_code: code, p_display_name: "Plus one" });
    expect(error?.code).toBe("KIT01");
    const { data: staff } = await admin.schema("kitchen").from("staff")
      .select("user_id").eq("org_id", orgId).eq("user_id", confederate.id);
    expect(staff).toEqual([]);
  });

  // on conflict do nothing is right to refuse the write, but the code was marked used
  // anyway and the page then said the person had joined. So an invite meant for a new
  // colleague could be consumed silently by anyone already employed, and the promotion the
  // owner thought they were sending never happened.
  it("refuses existing staff and leaves the code usable for the person it was for", async () => {
    const { owner, orgId } = await orgWithOwner("already");
    const { data: cookCode } = await k(owner.client)
      .rpc("create_invite", { p_org: orgId, p_role: "cook", p_site: null });
    const staffer = await makeUser(`kitchen-already-s-${stamp()}@t.dev`);
    await k(staffer.client).rpc("accept_invite", { p_code: cookCode, p_display_name: "Jo" });

    const { data: chefCode } = await k(owner.client)
      .rpc("create_invite", { p_org: orgId, p_role: "chef", p_site: null });
    const { error } = await k(staffer.client)
      .rpc("accept_invite", { p_code: chefCode, p_display_name: "Jo" });
    expect(error?.code).toBe("KIT02");

    // No silent promotion...
    const { data: row } = await admin.schema("kitchen").from("staff")
      .select("role").eq("org_id", orgId).eq("user_id", staffer.id).single();
    expect(row!.role).toBe("cook");
    // ...and the invite is still there for the colleague it was meant for.
    const newcomer = await makeUser(`kitchen-already-n-${stamp()}@t.dev`);
    const { error: theirs } = await k(newcomer.client)
      .rpc("accept_invite", { p_code: chefCode, p_display_name: "Ada" });
    expect(theirs).toBeNull();
  });
});
