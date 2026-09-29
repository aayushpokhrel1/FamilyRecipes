import { expect, test, vi, beforeEach } from "vitest";

const getUser = vi.fn();
const upsert = vi.fn();
const del = vi.fn();
const deleteEq = vi.fn();
const order = vi.fn();
const select = vi.fn();
vi.mock("../supabaseClient", () => ({
  supabase: {
    auth: { getUser: (...a: any[]) => getUser(...a) },
    from: () => ({
      upsert: (...a: any[]) => upsert(...a),
      delete: (...a: any[]) => del(...a),
      select: (...a: any[]) => select(...a),
    }),
  },
}));

beforeEach(() => {
  getUser.mockReset();
  upsert.mockReset();
  del.mockReset();
  deleteEq.mockReset();
  order.mockReset();
  select.mockReset();
  getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
  upsert.mockResolvedValue({ data: null, error: null });
  // removeBlock chains .delete().eq(...), so delete has to hand back the eq spy.
  del.mockReturnValue({ eq: deleteEq });
  deleteEq.mockResolvedValue({ data: null, error: null });
  // listMyBlocks chains .select("*").order(...), so select has to hand back the order spy.
  select.mockReturnValue({ order });
  order.mockResolvedValue({ data: [], error: null });
});

// The upsert is the whole point of one table with a kind: changing a mute to a block is one
// call, not a delete plus an insert. A plain insert here would fail on the primary key the
// second time and the UI would have to know to delete first.
test("setBlock upserts the current user as blocker_id with the given kind", async () => {
  const { setBlock } = await import("./blocks");
  await expect(setBlock("cook-1", "block")).resolves.toBeUndefined();
  expect(upsert).toHaveBeenCalledWith({
    blocker_id: "u1", blocked_id: "cook-1", kind: "block",
  });
});

test("setBlock throws the database message", async () => {
  const { setBlock } = await import("./blocks");
  upsert.mockResolvedValue({ data: null, error: { message: "no_self_block" } });
  await expect(setBlock("cook-1", "mute")).rejects.toThrow("no_self_block");
});

test("setBlock throws Not signed in when there is no user", async () => {
  const { setBlock } = await import("./blocks");
  getUser.mockResolvedValue({ data: { user: null } });
  await expect(setBlock("cook-1", "mute")).rejects.toThrow("Not signed in");
  expect(upsert).not.toHaveBeenCalled();
});

// RLS already scopes every row to blocker_id = auth.uid(), so filtering on it here would be
// a second copy of the same rule: the one that drifts and then silently deletes nothing.
test("removeBlock deletes filtered by blocked_id only", async () => {
  const { removeBlock } = await import("./blocks");
  await expect(removeBlock("cook-1")).resolves.toBeUndefined();
  expect(deleteEq).toHaveBeenCalledWith("blocked_id", "cook-1");
});

test("removeBlock throws the database message", async () => {
  const { removeBlock } = await import("./blocks");
  deleteEq.mockResolvedValue({ data: null, error: { message: "nope" } });
  await expect(removeBlock("cook-1")).rejects.toThrow("nope");
});

test("listMyBlocks returns the rows, newest first", async () => {
  const { listMyBlocks } = await import("./blocks");
  order.mockResolvedValue({
    data: [{
      blocker_id: "u1", blocked_id: "cook-1", kind: "block",
      created_at: "2026-09-28T00:00:00Z",
    }],
    error: null,
  });
  const got = await listMyBlocks();
  expect(got.map((b) => b.blocked_id)).toEqual(["cook-1"]);
  expect(select).toHaveBeenCalledWith("*");
  expect(order).toHaveBeenCalledWith("created_at", { ascending: false });
});

test("listMyBlocks returns an empty list rather than null", async () => {
  const { listMyBlocks } = await import("./blocks");
  order.mockResolvedValue({ data: null, error: null });
  await expect(listMyBlocks()).resolves.toEqual([]);
});

test("listMyBlocks throws the database message", async () => {
  const { listMyBlocks } = await import("./blocks");
  order.mockResolvedValue({ data: null, error: { message: "nope" } });
  await expect(listMyBlocks()).rejects.toThrow("nope");
});
