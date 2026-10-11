import { describe, it, expect, vi, beforeEach } from "vitest";
import { supabase } from "../../supabaseClient";
import {
  listDishes, createDish, listVersions, getVersion, reviseDish,
  sendToTrial, signOff, menuVersionId, publishDish, getSnapshot,
} from "./dishes";

const rpc = vi.fn();
const from = vi.fn();
vi.mock("../../supabaseClient", () => ({
  supabase: { schema: vi.fn(), from: vi.fn(), rpc: vi.fn() },
}));

beforeEach(() => {
  vi.clearAllMocks();
  (supabase.schema as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ rpc, from });
});

/** The supabase-js builder is a chain, so each test builds the chain it expects. */
function chain(result: unknown) {
  const order = vi.fn().mockResolvedValue(result);
  const eq = vi.fn().mockReturnValue({ order, maybeSingle: vi.fn().mockResolvedValue(result) });
  const select = vi.fn().mockReturnValue({ eq, order });
  from.mockReturnValue({ select });
  return { select, eq, order };
}

describe("listDishes", () => {
  it("reads one org's dishes through the kitchen schema", async () => {
    const { eq } = chain({ data: [{ id: "d1", org_id: "o1", title: "Tart", stage: "menu", trial_site_id: null }], error: null });
    const dishes = await listDishes("o1");
    expect(supabase.schema).toHaveBeenCalledWith("kitchen");
    expect(from).toHaveBeenCalledWith("dishes");
    expect(eq).toHaveBeenCalledWith("org_id", "o1");
    expect(dishes).toHaveLength(1);
  });

  it("returns an empty list rather than null", async () => {
    chain({ data: null, error: null });
    expect(await listDishes("o1")).toEqual([]);
  });
});

describe("createDish", () => {
  it("calls the RPC and returns the new id", async () => {
    rpc.mockResolvedValue({ data: "d1", error: null });
    expect(await createDish("o1", "Smoked onion tart")).toBe("d1");
    expect(rpc).toHaveBeenCalledWith("create_dish", { p_org: "o1", p_title: "Smoked onion tart" });
  });

  it("throws the database's own refusal", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "only an owner or a chef may start a dish", code: "KIT01" } });
    await expect(createDish("o1", "x")).rejects.toThrow("only an owner or a chef may start a dish");
  });
});

describe("listVersions", () => {
  it("reads newest first, because that is what a person wants to see", async () => {
    const { order } = chain({ data: [], error: null });
    await listVersions("d1");
    expect(from).toHaveBeenCalledWith("dish_versions");
    expect(order).toHaveBeenCalledWith("n", { ascending: false });
  });
});

describe("getVersion", () => {
  it("reads ingredients and steps for one version, each in position order", async () => {
    const order = vi.fn().mockResolvedValue({ data: [], error: null });
    const eq = vi.fn().mockReturnValue({ order });
    const select = vi.fn().mockReturnValue({ eq });
    from.mockReturnValue({ select });
    const v = await getVersion("v1");
    expect(from).toHaveBeenCalledWith("dish_ingredients");
    expect(from).toHaveBeenCalledWith("dish_steps");
    expect(eq).toHaveBeenCalledWith("version_id", "v1");
    expect(order).toHaveBeenCalledWith("position");
    // An empty dish is reachable: revise_dish accepts an empty list. It must not crash.
    expect(v).toEqual({ ingredients: [], steps: [] });
  });
});

describe("reviseDish", () => {
  it("sends the ingredients and steps as json, with the note", async () => {
    rpc.mockResolvedValue({ data: "v2", error: null });
    const ingredients = [{ position: 1, quantity: "2", unit: null, item: "onions", section: null }];
    const steps = [{ position: 1, text: "Smoke them." }];
    expect(await reviseDish("d1", "more salt", ingredients, steps)).toBe("v2");
    expect(rpc).toHaveBeenCalledWith("revise_dish", {
      p_dish: "d1",
      p_note: "more salt",
      p_ingredients: ingredients,
      p_steps: steps,
    });
  });
});

describe("the pipeline calls", () => {
  it("sends a dish to one site", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    await sendToTrial("d1", "s1");
    expect(rpc).toHaveBeenCalledWith("send_to_trial", { p_dish: "d1", p_site: "s1" });
  });

  it("surfaces the wrong-stage refusal rather than appearing to succeed", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "trial that dish at a site first", code: "KIT02" } });
    await expect(signOff("v1")).rejects.toThrow("trial that dish at a site first");
  });

  it("asks the database which version the sites are actually cooking", async () => {
    rpc.mockResolvedValue({ data: "v1", error: null });
    expect(await menuVersionId("d1")).toBe("v1");
    expect(rpc).toHaveBeenCalledWith("menu_version", { p_dish: "d1" });
  });

  it("reports no menu version as null rather than throwing", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    expect(await menuVersionId("d1")).toBeNull();
  });
});

describe("publishing", () => {
  it("returns the public recipe id", async () => {
    rpc.mockResolvedValue({ data: "r1", error: null });
    expect(await publishDish("v1")).toBe("r1");
    expect(rpc).toHaveBeenCalledWith("publish_dish", { p_version: "v1" });
  });

  it("surfaces the owner-only refusal", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "only an owner may publish a dish", code: "KIT01" } });
    await expect(publishDish("v1")).rejects.toThrow("only an owner may publish a dish");
  });

  it("reports an unpublished dish as null rather than an error", async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
    const eq = vi.fn().mockReturnValue({ maybeSingle });
    const select = vi.fn().mockReturnValue({ eq });
    from.mockReturnValue({ select });
    expect(await getSnapshot("d1")).toBeNull();
  });
});
