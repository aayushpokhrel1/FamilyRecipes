import { describe, it, expect, vi, beforeEach } from "vitest";
import { supabase } from "../../supabaseClient";
import { groupNumbers, myGroupNumbers } from "./numbers";

const rpc = vi.fn();
vi.mock("../../supabaseClient", () => ({
  supabase: { schema: vi.fn(), from: vi.fn(), rpc: vi.fn() },
}));

beforeEach(() => {
  vi.clearAllMocks();
  (supabase.schema as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ rpc });
});

describe("groupNumbers", () => {
  it("returns the figures for a caller who is served them", async () => {
    const figures = {
      dishes: { started: 2, landed: 1, median_days: 3, slow: [] },
      funnel: { dishes: 2, with_version: 2, trialled: 1, landed: 1, on_menu: 0 },
      sites: [],
    };
    rpc.mockResolvedValue({ data: figures, error: null });
    expect(await groupNumbers("org-1")).toEqual(figures);
  });

  it("returns null when the database answers with an empty object", async () => {
    // {} is kitchen.group_numbers refusing a reader who is not owner or chef. It must never
    // be reported as a group with nothing in it.
    rpc.mockResolvedValue({ data: {}, error: null });
    expect(await groupNumbers("org-1")).toBeNull();
  });

  it("returns null when the database answers with null", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    expect(await groupNumbers("org-1")).toBeNull();
  });

  it("throws the database message on error", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "permission denied for function group_numbers" } });
    await expect(groupNumbers("org-1")).rejects.toThrow("permission denied for function group_numbers");
  });

  it("calls the function with the org id", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    await groupNumbers("org-1");
    expect(rpc).toHaveBeenCalledWith("group_numbers", { p_org: "org-1" });
  });

  it("goes through the kitchen schema", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    await groupNumbers("org-1");
    expect(supabase.schema).toHaveBeenCalledWith("kitchen");
  });
});

describe("myGroupNumbers", () => {
  it("returns a record keyed by org id", async () => {
    const record = { "org-1": { started: 2, landed: 1, median_days: 3 } };
    rpc.mockResolvedValue({ data: record, error: null });
    expect(await myGroupNumbers()).toEqual(record);
  });

  it("returns an empty record when there is nothing", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    expect(await myGroupNumbers()).toEqual({});
  });

  it("passes no argument at all", async () => {
    // The function's subject is auth.uid(), so there is no uuid for a caller to substitute.
    rpc.mockResolvedValue({ data: null, error: null });
    await myGroupNumbers();
    expect(rpc).toHaveBeenCalledWith("my_group_numbers");
  });

  it("throws the database message on error", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "permission denied for function my_group_numbers" } });
    await expect(myGroupNumbers()).rejects.toThrow("permission denied for function my_group_numbers");
  });
});
