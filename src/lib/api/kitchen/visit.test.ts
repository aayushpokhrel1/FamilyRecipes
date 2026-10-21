import { describe, it, expect, vi, beforeEach } from "vitest";
import { supabase } from "../../supabaseClient";
import { kitchenSurfaceFor } from "./visit";

const rpc = vi.fn();
vi.mock("../../supabaseClient", () => ({
  supabase: { schema: vi.fn(), from: vi.fn(), rpc: vi.fn() },
}));

beforeEach(() => {
  vi.clearAllMocks();
  // The dedupe set is module state, so every test needs its own copy of the module.
  vi.resetModules();
  (supabase.schema as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ rpc });
  rpc.mockResolvedValue({ data: null, error: null });
});

// recordKitchenVisit touches module state, so it gets a fresh module per test.
async function loadRecordKitchenVisit() {
  return (await import("./visit")).recordKitchenVisit;
}

describe("kitchenSurfaceFor", () => {
  it("maps each group page to its surface", () => {
    expect(kitchenSurfaceFor("/orgs/org-1/sites")).toBe("sites");
    expect(kitchenSurfaceFor("/orgs/org-1/staff")).toBe("staff");
    expect(kitchenSurfaceFor("/orgs/org-1/dishes")).toBe("dishes");
    expect(kitchenSurfaceFor("/orgs/org-1/numbers")).toBe("numbers");
    expect(kitchenSurfaceFor("/orgs/org-1/settings")).toBe("settings");
  });

  it("a dish detail page is the dishes surface", () => {
    // The feature being measured is the dish pipeline, and a per-dish row would answer a
    // much more sensitive question.
    expect(kitchenSurfaceFor("/orgs/org-1/dishes/dish-9")).toBe("dishes");
  });

  it("returns null outside a group", () => {
    expect(kitchenSurfaceFor("/")).toBeNull();
    expect(kitchenSurfaceFor("/orgs/new")).toBeNull();
    expect(kitchenSurfaceFor("/terms")).toBeNull();
    expect(kitchenSurfaceFor("/join/abc")).toBeNull();
    expect(kitchenSurfaceFor("/signin")).toBeNull();
    expect(kitchenSurfaceFor("/orgs/org-1")).toBeNull();
    expect(kitchenSurfaceFor("/orgs/org-1/nope")).toBeNull();
  });
});

describe("recordKitchenVisit", () => {
  it("records one call per org, day and surface", async () => {
    const recordKitchenVisit = await loadRecordKitchenVisit();

    recordKitchenVisit("org-1", "/orgs/org-1/sites");
    recordKitchenVisit("org-1", "/orgs/org-1/sites");

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("record_kitchen_visit", {
      p_org: "org-1",
      p_day: expect.any(String),
      p_surface: "sites",
    });
  });

  it("records the same surface separately for two groups", async () => {
    const recordKitchenVisit = await loadRecordKitchenVisit();

    recordKitchenVisit("org-1", "/orgs/org-1/sites");
    recordKitchenVisit("org-2", "/orgs/org-2/sites");

    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_org: "org-1", p_surface: "sites" });
    expect(rpc.mock.calls[1][1]).toMatchObject({ p_org: "org-2", p_surface: "sites" });
  });

  it("never throws when the call rejects", async () => {
    // A rejected promise is not caught by the surrounding try/catch when nothing awaits it,
    // so without the rejection handler this test fails with an unhandled rejection.
    rpc.mockImplementation(() => ({
      then: (_ok: unknown, fail?: (e: unknown) => void) => fail?.(new Error("nope")),
    }));
    const recordKitchenVisit = await loadRecordKitchenVisit();

    expect(() => recordKitchenVisit("org-1", "/orgs/org-1/sites")).not.toThrow();
  });

  it("writes nothing to localStorage or sessionStorage", async () => {
    // A stored key would be a non-essential identifier on the device, which makes a consent
    // banner legally mandatory and fails src/lib/browserStorage.test.ts.
    const local = vi.spyOn(Storage.prototype, "setItem");
    const recordKitchenVisit = await loadRecordKitchenVisit();

    recordKitchenVisit("org-1", "/orgs/org-1/sites");

    expect(local).not.toHaveBeenCalled();
    local.mockRestore();
  });
});