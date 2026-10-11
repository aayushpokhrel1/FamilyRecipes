import { describe, it, expect, vi, beforeEach } from "vitest";
import { supabase } from "../../supabaseClient";
import { createOrg, myOrgs, addSite, listSites, listStaff } from "./orgs";

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
