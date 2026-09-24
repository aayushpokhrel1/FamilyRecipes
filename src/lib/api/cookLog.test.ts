// src/lib/api/cookLog.test.ts
import { vi, test, expect } from "vitest";
const from = vi.fn();
const getUser = vi.fn().mockResolvedValue({ data: { user: { id: "me" } } });
vi.mock("../supabaseClient", () => ({ supabase: {
  from: (...a: any[]) => from(...a),
  auth: { getUser: (...a: any[]) => getUser(...a) },
}}));
import { logCooked, notCookedLately } from "./cookLog";

// A fixed "now" so the 90-day threshold is not a moving target.
const NOW = new Date("2026-06-01T12:00:00Z").getTime();
const daysAgo = (n: number) => new Date(NOW - n * 24 * 60 * 60 * 1000).toISOString();

test("notCookedLately sorts oldest-first and puts never-cooked recipes last", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  from.mockImplementation((table: string) => {
    if (table === "recipes") {
      return { select: () => ({ eq: () => ({ data: [
        { id: "r1", title: "Dal" },
        { id: "r2", title: "Biryani" },
        { id: "r3", title: "Never made" },
      ], error: null }) }) };
    }
    if (table === "cook_log") {
      // newest first, as the query orders them
      return { select: () => ({ eq: () => ({ order: () => ({ data: [
        { recipe_id: "r1", cooked_at: daysAgo(200) },
        { recipe_id: "r2", cooked_at: daysAgo(300) },
      ], error: null }) }) }) };
    }
    throw new Error(`unexpected table ${table}`);
  });

  const out = await notCookedLately("f1", 10);
  expect(out.map((r) => r.recipe.id)).toEqual(["r2", "r1", "r3"]);
  expect(out[2].lastCooked).toBeNull();
  vi.useRealTimers();
});

test("notCookedLately excludes a recipe cooked within the last 90 days", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  from.mockImplementation((table: string) => {
    if (table === "recipes") {
      return { select: () => ({ eq: () => ({ data: [
        { id: "r1", title: "Dal" },
        { id: "r2", title: "Biryani" },
      ], error: null }) }) };
    }
    if (table === "cook_log") {
      return { select: () => ({ eq: () => ({ order: () => ({ data: [
        { recipe_id: "r1", cooked_at: daysAgo(10) },
        { recipe_id: "r2", cooked_at: daysAgo(120) },
      ], error: null }) }) }) };
    }
    throw new Error(`unexpected table ${table}`);
  });

  const out = await notCookedLately("f1", 10);
  expect(out.map((r) => r.recipe.id)).toEqual(["r2"]);
  vi.useRealTimers();
});

test("logCooked throws \"Not signed in\" with no user and performs no insert", async () => {
  getUser.mockResolvedValueOnce({ data: { user: null } });
  const insert = vi.fn();
  from.mockImplementation(() => ({ insert }));
  await expect(logCooked("f1", "r1")).rejects.toThrow("Not signed in");
  expect(insert).not.toHaveBeenCalled();
});
