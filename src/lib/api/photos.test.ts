import { vi, test, expect, beforeEach } from "vitest";
const from = vi.fn();
const upload = vi.fn();
vi.mock("../supabaseClient", () => ({ supabase: {
  from: (...a: any[]) => from(...a),
  storage: { from: (...a: any[]) => ({ upload: (...b: any[]) => upload(...a, ...b) }) },
}}));
import { uploadRecipePhoto } from "./photos";

// Records what was inserted and what was demoted, and lets .eq()/.neq() chain in any order.
function mockTable() {
  const inserted: any[] = [];
  const demoted: any[] = [];
  from.mockImplementation((table: string) => ({
    insert: (payload: any) => {
      inserted.push({ table, payload });
      return { select: () => ({ single: () => ({ data: { id: "ph1", ...payload }, error: null }) }) };
    },
    update: (payload: any) => {
      const call: any = { table, payload, filters: {} };
      demoted.push(call);
      const chain: any = {
        eq: (col: string, val: unknown) => { call.filters[col] = val; return chain; },
        neq: (col: string, val: unknown) => { call.filters["not:" + col] = val; return chain; },
        then: (resolve: (v: unknown) => unknown) => resolve({ error: null }),
      };
      return chain;
    },
  }));
  return { inserted, demoted };
}

beforeEach(() => {
  vi.clearAllMocks();
  upload.mockResolvedValue({ data: { path: "p" }, error: null });
});

test("uploadRecipePhoto uploads the file then inserts a recipe_photos row", async () => {
  const { inserted } = mockTable();
  const file = new File(["x"], "cover.png", { type: "image/png" });
  const photo = await uploadRecipePhoto("r1", file, true);
  expect(upload).toHaveBeenCalledWith("recipe-photos", expect.stringContaining("r1/"), file);
  expect(photo.id).toBe("ph1");
  expect(inserted[0].table).toBe("recipe_photos");
  expect(inserted[0].payload.recipe_id).toBe("r1");
  expect(inserted[0].payload.is_cover).toBe(true);
});

// The bug: editing a recipe and picking a photo ADDED a second cover instead of replacing
// the first, so covers piled up and which one showed came down to row order.
test("a new cover demotes the previous ones, excluding itself", async () => {
  const { demoted } = mockTable();
  await uploadRecipePhoto("r1", new File(["x"], "c.png"), true);
  expect(demoted).toHaveLength(1);
  expect(demoted[0].payload).toEqual({ is_cover: false });
  expect(demoted[0].filters.recipe_id).toBe("r1");
  expect(demoted[0].filters.is_cover).toBe(true);
  // Excluding the row just inserted, or the upload would demote its own cover.
  expect(demoted[0].filters["not:id"]).toBe("ph1");
});

test("a non-cover upload demotes nothing", async () => {
  const { demoted } = mockTable();
  await uploadRecipePhoto("r1", new File(["x"], "c.png"), false);
  expect(demoted).toHaveLength(0);
});
