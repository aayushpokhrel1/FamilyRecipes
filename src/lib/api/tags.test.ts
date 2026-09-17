import { vi, test, expect } from "vitest";
const from = vi.fn();
vi.mock("../supabaseClient", () => ({ supabase: {
  from: (...a: any[]) => from(...a),
  auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "me" } } }) },
}}));
import { setRecipeTags } from "./tags";
test("setRecipeTags deletes existing links then inserts one row per tag", async () => {
  const calls: any[] = [];
  const inserted: any[] = [];
  from.mockImplementation((table: string) => ({
    delete: () => {
      calls.push({ table, op: "delete" });
      return { eq: (col: string, val: any) => {
        calls.push({ table, op: "delete.eq", col, val });
        return { error: null };
      } };
    },
    insert: (payload: any) => {
      inserted.push({ table, payload });
      return { error: null };
    },
  }));
  await setRecipeTags("r1", ["t1", "t2"]);
  expect(calls[0]).toEqual({ table: "recipe_tags", op: "delete" });
  expect(calls[1]).toEqual({ table: "recipe_tags", op: "delete.eq", col: "recipe_id", val: "r1" });
  expect(inserted[0].table).toBe("recipe_tags");
  expect(inserted[0].payload).toEqual([
    { recipe_id: "r1", tag_id: "t1" },
    { recipe_id: "r1", tag_id: "t2" },
  ]);
});
