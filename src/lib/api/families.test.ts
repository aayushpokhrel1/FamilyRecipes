import { vi, test, expect } from "vitest";
const from = vi.fn();
const rpc = vi.fn();
vi.mock("../supabaseClient", () => ({ supabase: {
  from: (...a: any[]) => from(...a),
  rpc: (...a: any[]) => rpc(...a),
  auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "me" } } }) },
}}));
import { listMyFamilies, familyNameForCode } from "./families";
test("listMyFamilies returns families for the user", async () => {
  from.mockReturnValueOnce({ select: () => ({ data: [{ family_id: "f1" }], error: null }) });
  from.mockReturnValueOnce({ select: () => ({ in: () => ({ data: [{ id: "f1", name: "Fam" }], error: null }) }) });
  const fams = await listMyFamilies();
  expect(fams[0].name).toBe("Fam");
});
test("familyNameForCode returns the name behind the code", async () => {
  rpc.mockResolvedValueOnce({ data: "Fam", error: null });
  await expect(familyNameForCode("abc")).resolves.toBe("Fam");
});
test("familyNameForCode returns null when no family has the code", async () => {
  rpc.mockResolvedValueOnce({ data: null, error: null });
  await expect(familyNameForCode("nope")).resolves.toBeNull();
});
test("familyNameForCode throws the database message on error", async () => {
  rpc.mockResolvedValueOnce({ data: null, error: { message: "boom" } });
  await expect(familyNameForCode("abc")).rejects.toThrow("boom");
});
