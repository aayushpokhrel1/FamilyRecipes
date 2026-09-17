import { vi, test, expect } from "vitest";
const from = vi.fn();
const upload = vi.fn();
vi.mock("../supabaseClient", () => ({ supabase: {
  from: (...a: any[]) => from(...a),
  storage: { from: (...a: any[]) => ({ upload: (...b: any[]) => upload(...a, ...b) }) },
}}));
import { uploadRecipePhoto } from "./photos";
test("uploadRecipePhoto uploads the file then inserts a recipe_photos row", async () => {
  upload.mockResolvedValueOnce({ data: { path: "p" }, error: null });
  const inserted: any[] = [];
  from.mockImplementation((table: string) => ({
    insert: (payload: any) => {
      inserted.push({ table, payload });
      return { select: () => ({ single: () => ({ data: { id: "ph1", ...payload }, error: null }) }) };
    },
  }));
  const file = new File(["x"], "cover.png", { type: "image/png" });
  const photo = await uploadRecipePhoto("r1", file, true);
  expect(upload).toHaveBeenCalledWith("recipe-photos", expect.stringContaining("r1/"), file);
  expect(photo.id).toBe("ph1");
  expect(inserted[0].table).toBe("recipe_photos");
  expect(inserted[0].payload.recipe_id).toBe("r1");
  expect(inserted[0].payload.is_cover).toBe(true);
});
