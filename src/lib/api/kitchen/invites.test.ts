import { describe, it, expect, vi, beforeEach } from "vitest";
import { supabase } from "../../supabaseClient";
import { createInvite, peekInvite, acceptInvite } from "./invites";

const rpc = vi.fn();
vi.mock("../../supabaseClient", () => ({
  supabase: { schema: vi.fn(), from: vi.fn(), rpc: vi.fn() },
}));

beforeEach(() => {
  vi.clearAllMocks();
  (supabase.schema as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ rpc, from: vi.fn() });
});

describe("createInvite", () => {
  it("sends a null site for a group-wide role rather than omitting it", async () => {
    rpc.mockResolvedValue({ data: "deadbeef", error: null });
    expect(await createInvite("org-1", "chef", null)).toBe("deadbeef");
    expect(rpc).toHaveBeenCalledWith("create_invite", {
      p_org: "org-1",
      p_role: "chef",
      p_site: null,
    });
  });
});

describe("peekInvite", () => {
  it("returns the one row the database gives back for a code", async () => {
    rpc.mockResolvedValue({
      data: [{ org_name: "Enamel Group", role: "site_manager", site_name: "Shoreditch" }],
      error: null,
    });
    expect(await peekInvite("abc")).toEqual({
      org_name: "Enamel Group",
      role: "site_manager",
      site_name: "Shoreditch",
    });
  });

  it("returns null for a code that is used or does not exist", async () => {
    // peek_invite is a table-returning function, so a miss is an EMPTY ARRAY, not null, and
    // reading data[0] without this check is how a used link renders as "undefined invites you".
    rpc.mockResolvedValue({ data: [], error: null });
    expect(await peekInvite("gone")).toBeNull();
  });

  it("does not throw for a stranger with no session", async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    await expect(peekInvite("abc")).resolves.toBeNull();
  });
});

describe("acceptInvite", () => {
  it("passes the code and the name, and returns the org joined", async () => {
    rpc.mockResolvedValue({ data: "org-1", error: null });
    expect(await acceptInvite("abc", "Ada")).toBe("org-1");
    expect(rpc).toHaveBeenCalledWith("accept_invite", { p_code: "abc", p_display_name: "Ada" });
  });

  it("throws the database's refusal, which the page shows as it is", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { message: "that invite is not valid any more", code: "KIT04" },
    });
    await expect(acceptInvite("abc", "Ada")).rejects.toThrow("that invite is not valid any more");
  });
});
