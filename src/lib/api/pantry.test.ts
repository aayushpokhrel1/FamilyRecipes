import { vi, test, expect, beforeEach } from "vitest";
const from = vi.fn();
vi.mock("../supabaseClient", () => ({ supabase: {
  from: (...a: any[]) => from(...a),
}}));
import { addItem } from "./pantry";

// Builds a mock table whose lookup returns `existing`, and captures whatever
// gets upserted so the test can assert on it.
function mockTable(existing: { kind: string } | null) {
  const captured: { row?: any } = {};
  from.mockImplementation(() => ({
    select: () => ({
      eq: () => ({ eq: () => ({ maybeSingle: () => ({ data: existing, error: null }) }) }),
    }),
    upsert: (row: any) => {
      captured.row = row;
      return { select: () => ({ single: () => ({ data: { id: "x", ...row }, error: null }) }) };
    },
  }));
  return captured;
}

beforeEach(() => from.mockReset());

// Found in a browser, not in this file. Buying salt off the grocery list calls
// addItem(..., "week"), and the upsert used to overwrite kind, so a staple the
// family always keeps became something that expires in seven days. The
// cupboard would have quietly emptied itself of its own staples.
test("restocking a staple does not demote it to a week item", async () => {
  const captured = mockTable({ kind: "keep" });
  const item = await addItem("f1", "Salt", "week");
  expect(captured.row).toMatchObject({ kind: "keep", state: "have", expires_on: null });
  expect(item.kind).toBe("keep");
});

test("something genuinely new arrives as a week item with an expiry", async () => {
  const captured = mockTable(null);
  await addItem("f1", "Chicken thighs", "week");
  expect(captured.row.kind).toBe("week");
  expect(captured.row.expires_on).toMatch(/^\d{4}-\d{2}-\d{2}$/);
});

// An existing week item being re-bought stays a week item, and its expiry is
// pushed out rather than left to run down from the original purchase.
test("re-buying a week item keeps it a week item", async () => {
  const captured = mockTable({ kind: "week" });
  await addItem("f1", "Spinach", "week");
  expect(captured.row.kind).toBe("week");
  expect(captured.row.expires_on).not.toBeNull();
});

test("adding to the cupboard directly never consults the existing row", async () => {
  const captured = mockTable(null);
  await addItem("f1", "Olive oil");
  expect(captured.row).toMatchObject({ kind: "keep", expires_on: null });
});

test("the stored key is normalized so spellings merge", async () => {
  const captured = mockTable(null);
  await addItem("f1", "  Chopped Onions  ");
  expect(captured.row.key).toBe("onion");
  expect(captured.row.label).toBe("Chopped Onions");
});
