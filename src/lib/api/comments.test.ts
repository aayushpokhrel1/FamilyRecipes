import { vi, test, expect } from "vitest";
const from = vi.fn();
vi.mock("../supabaseClient", () => ({ supabase: {
  from: (...a: any[]) => from(...a),
  auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "me" } } }) },
}}));
import { addComment } from "./comments";
test("addComment inserts the comment with the current user as author", async () => {
  const inserted: any[] = [];
  from.mockImplementation((table: string) => ({
    insert: (payload: any) => {
      inserted.push({ table, payload });
      return { select: () => ({ single: () => ({ data: { id: "c1", ...payload }, error: null }) }) };
    },
  }));
  const comment = await addComment("r1", "Looks great");
  expect(comment.id).toBe("c1");
  expect(inserted[0].table).toBe("comments");
  expect(inserted[0].payload.author_id).toBe("me");
  expect(inserted[0].payload.recipe_id).toBe("r1");
  expect(inserted[0].payload.body).toBe("Looks great");
});
