import { expect, test, vi, beforeEach } from "vitest";

const rpc = vi.fn();
const inFilter = vi.fn();
vi.mock("../supabaseClient", () => ({
  supabase: {
    rpc: (...a: any[]) => rpc(...a),
    from: () => ({ select: () => ({ eq: () => ({ in: (...a: any[]) => inFilter(...a) }) }) }),
  },
}));

beforeEach(() => {
  rpc.mockReset();
  inFilter.mockReset();
});

test("saveToVault returns the new recipe id", async () => {
  const { saveToVault } = await import("./saves");
  rpc.mockResolvedValue({ data: "new-id", error: null });
  await expect(saveToVault("src-1", "fam-1")).resolves.toBe("new-id");
  expect(rpc).toHaveBeenCalledWith("save_recipe_to_vault", {
    p_source: "src-1", p_family: "fam-1",
  });
});

test("saveToVault throws the database message", async () => {
  const { saveToVault } = await import("./saves");
  rpc.mockResolvedValue({ data: null, error: { message: "not available to save" } });
  await expect(saveToVault("src-1", "fam-1")).rejects.toThrow("not available to save");
});

// One call for the whole page, never one per card. Potluck already holds this rule for
// bylines and it is pinned by a test there for the same reason.
test("listSavedSourceIds asks once for every id and returns a set", async () => {
  const { listSavedSourceIds } = await import("./saves");
  inFilter.mockResolvedValue({
    data: [{ source_recipe_id: "a" }, { source_recipe_id: "c" }], error: null,
  });
  const got = await listSavedSourceIds("fam-1", ["a", "b", "c"]);
  expect(got).toEqual(new Set(["a", "c"]));
  expect(inFilter).toHaveBeenCalledTimes(1);
  expect(inFilter).toHaveBeenCalledWith("source_recipe_id", ["a", "b", "c"]);
});

test("listSavedSourceIds does not query at all for an empty list", async () => {
  const { listSavedSourceIds } = await import("./saves");
  const got = await listSavedSourceIds("fam-1", []);
  expect(got).toEqual(new Set());
  expect(inFilter).not.toHaveBeenCalled();
});
