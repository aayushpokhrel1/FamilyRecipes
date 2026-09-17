import { vi, test, expect } from "vitest";
const from = vi.fn();
vi.mock("../supabaseClient", () => ({ supabase: {
  from: (...a: any[]) => from(...a),
  auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "me" } } }) },
}}));
import { listMyFamilies } from "./families";
test("listMyFamilies returns families for the user", async () => {
  from.mockReturnValueOnce({ select: () => ({ data: [{ family_id: "f1" }], error: null }) });
  from.mockReturnValueOnce({ select: () => ({ in: () => ({ data: [{ id: "f1", name: "Fam" }], error: null }) }) });
  const fams = await listMyFamilies();
  expect(fams[0].name).toBe("Fam");
});
