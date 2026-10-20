import { describe, it, expect, vi, beforeEach } from "vitest";
import { supabase } from "../../supabaseClient";
import { createOrg, myOrgs, addSite, listSites, listStaff, closeSite, reopenSite, eraseOrg, siteClosureImpact } from "./orgs";

// Every kitchen call goes through supabase.schema("kitchen"), because these tables are NOT in
// the public schema and PostgREST will not find them otherwise. That one call is the easiest
// thing in this layer to forget, so each test asserts it.
const rpc = vi.fn();
const from = vi.fn();
vi.mock("../../supabaseClient", () => ({
  supabase: { schema: vi.fn(), from: vi.fn(), rpc: vi.fn() },
}));

beforeEach(() => {
  vi.clearAllMocks();
  (supabase.schema as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ rpc, from });
});

describe("createOrg", () => {
  it("calls the one RPC that makes the creator the owner, and returns the id", async () => {
    rpc.mockResolvedValue({ data: "org-1", error: null });
    const id = await createOrg("Enamel Group", "Sam");
    expect(supabase.schema).toHaveBeenCalledWith("kitchen");
    expect(rpc).toHaveBeenCalledWith("create_org", {
      p_name: "Enamel Group",
      p_display_name: "Sam",
    });
    expect(id).toBe("org-1");
  });

  it("throws the database's message rather than a generic one", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "sign in first", code: "KIT01" } });
    await expect(createOrg("x", "y")).rejects.toThrow("sign in first");
  });
});

describe("myOrgs", () => {
  it("reads the orgs the caller is staff of", async () => {
    const select = vi.fn().mockResolvedValue({ data: [{ id: "org-1", name: "Enamel" }], error: null });
    from.mockReturnValue({ select });
    const orgs = await myOrgs();
    expect(from).toHaveBeenCalledWith("orgs");
    expect(orgs).toEqual([{ id: "org-1", name: "Enamel" }]);
  });

  it("returns an empty list rather than null, so a caller can map it", async () => {
    const select = vi.fn().mockResolvedValue({ data: null, error: null });
    from.mockReturnValue({ select });
    expect(await myOrgs()).toEqual([]);
  });
});

describe("addSite", () => {
  it("passes the org and the name to the RPC", async () => {
    rpc.mockResolvedValue({ data: "site-1", error: null });
    expect(await addSite("org-1", "Shoreditch")).toBe("site-1");
    expect(rpc).toHaveBeenCalledWith("add_site", { p_org: "org-1", p_name: "Shoreditch" });
  });
});

describe("listSites", () => {
  it("reads the sites of one org in a stable order", async () => {
    const order = vi.fn().mockResolvedValue({ data: [], error: null });
    const eq = vi.fn().mockReturnValue({ order });
    const select = vi.fn().mockReturnValue({ eq });
    from.mockReturnValue({ select });
    await listSites("org-1");
    expect(from).toHaveBeenCalledWith("sites");
    expect(select).toHaveBeenCalledWith("id,org_id,name,closed_at");
    expect(eq).toHaveBeenCalledWith("org_id", "org-1");
    expect(order).toHaveBeenCalledWith("name");
  });
});

describe("listStaff", () => {
  it("reads the roster of one org", async () => {
    const order = vi.fn().mockResolvedValue({ data: [], error: null });
    const eq = vi.fn().mockReturnValue({ order });
    const select = vi.fn().mockReturnValue({ eq });
    from.mockReturnValue({ select });
    await listStaff("org-1");
    expect(from).toHaveBeenCalledWith("staff");
    expect(eq).toHaveBeenCalledWith("org_id", "org-1");
  });
});

describe("closing and erasing", () => {
  it("closes a site by id", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    await closeSite("site-1");
    expect(rpc).toHaveBeenCalledWith("close_site", { p_site: "site-1" });
  });

  it("surfaces the refusal rather than appearing to succeed", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "only an owner may close a site", code: "KIT01" } });
    await expect(closeSite("site-1")).rejects.toThrow("only an owner may close a site");
  });

  it("reopens a site by id", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    await reopenSite("site-1");
    expect(rpc).toHaveBeenCalledWith("reopen_site", { p_site: "site-1" });
  });

  it("surfaces the refusal on reopen too", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "that site is not closed", code: "KIT02" } });
    await expect(reopenSite("site-1")).rejects.toThrow("that site is not closed");
  });

  it("erases an org by id", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    await eraseOrg("org-1");
    expect(rpc).toHaveBeenCalledWith("erase_org", { p_org: "org-1" });
  });

  it("surfaces the refusal on erase too", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "only an owner may erase an org", code: "KIT01" } });
    await expect(eraseOrg("org-1")).rejects.toThrow("only an owner may erase an org");
  });
});

describe("siteClosureImpact", () => {
  // A PostgREST query is one chainable builder that is awaited at the END, so every link has
  // to return the builder itself and the builder has to be thenable. Mocking it the other way
  // round, with the terminal call returning the result, passes for a chain of one and breaks
  // the moment a second `.eq()` is added.
  type CountResult = { count: number | null; error: { message: string } | null };
  function countBuilder(result: CountResult) {
    const calls = { select: vi.fn(), eq: vi.fn(), in: vi.fn() };
    const self = {
      select: (...a: unknown[]) => (calls.select(...a), self),
      eq: (...a: unknown[]) => (calls.eq(...a), self),
      in: (...a: unknown[]) => (calls.in(...a), self),
      then: (ok: (v: CountResult) => unknown, no?: (e: unknown) => unknown) =>
        Promise.resolve(result).then(ok, no),
    };
    return { self, calls };
  }

  it("counts the trial dishes and the people that closing the site will move", async () => {
    const dishes = countBuilder({ count: 3, error: null });
    const staff = countBuilder({ count: 2, error: null });
    from.mockReturnValueOnce(dishes.self).mockReturnValueOnce(staff.self);

    expect(await siteClosureImpact("site-1")).toEqual({ dishes: 3, people: 2 });
    expect(from).toHaveBeenCalledWith("dishes");
    expect(from).toHaveBeenCalledWith("staff");
    expect(dishes.calls.eq).toHaveBeenCalledWith("trial_site_id", "site-1");
    expect(dishes.calls.eq).toHaveBeenCalledWith("stage", "trial");
    expect(staff.calls.eq).toHaveBeenCalledWith("site_id", "site-1");
    expect(staff.calls.in).toHaveBeenCalledWith("role", ["cook", "site_manager"]);
  });

  it("asks for a column kitchen.staff actually has", async () => {
    // staff is keyed on (org_id, user_id). Selecting `id` errors in PostgREST even under
    // `head: true`, which is how the integration suite found the same mistake.
    const dishes = countBuilder({ count: 0, error: null });
    const staff = countBuilder({ count: 0, error: null });
    from.mockReturnValueOnce(dishes.self).mockReturnValueOnce(staff.self);
    await siteClosureImpact("site-1");
    expect(staff.calls.select).toHaveBeenCalledWith("org_id", { count: "exact", head: true });
  });

  it("returns zeros rather than nulls when the counts come back null", async () => {
    const dishes = countBuilder({ count: null, error: null });
    const staff = countBuilder({ count: null, error: null });
    from.mockReturnValueOnce(dishes.self).mockReturnValueOnce(staff.self);
    expect(await siteClosureImpact("site-1")).toEqual({ dishes: 0, people: 0 });
  });

  it("throws when the dish count fails", async () => {
    const dishes = countBuilder({ count: null, error: { message: "sign in first" } });
    from.mockReturnValueOnce(dishes.self);
    await expect(siteClosureImpact("site-1")).rejects.toThrow("sign in first");
  });

  it("throws when the people count fails", async () => {
    const dishes = countBuilder({ count: 1, error: null });
    const staff = countBuilder({ count: null, error: { message: "sign in first" } });
    from.mockReturnValueOnce(dishes.self).mockReturnValueOnce(staff.self);
    await expect(siteClosureImpact("site-1")).rejects.toThrow("sign in first");
  });
});
