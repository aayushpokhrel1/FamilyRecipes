import { vi, test, expect } from "vitest";
const rpc = vi.fn().mockResolvedValue({ error: null });
vi.mock("../supabaseClient", () => ({ supabase: {
  rpc: (...a: any[]) => rpc(...a),
  auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "me" } } }) },
}}));
import { setRecipeTags } from "./tags";
test("setRecipeTags replaces tags atomically via the set_recipe_tags RPC", async () => {
  await setRecipeTags("r1", ["t1", "t2"]);
  expect(rpc).toHaveBeenCalledWith("set_recipe_tags", {
    p_recipe_id: "r1",
    p_tag_ids: ["t1", "t2"],
  });
});
