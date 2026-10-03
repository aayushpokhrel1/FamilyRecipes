import { expect, test, vi, beforeEach } from "vitest";

const rpc = vi.fn();
const getUser = vi.fn();
const insert = vi.fn();
const order = vi.fn();
const isFilter = vi.fn();
const select = vi.fn();
vi.mock("../supabaseClient", () => ({
  supabase: {
    rpc: (...a: any[]) => rpc(...a),
    auth: { getUser: (...a: any[]) => getUser(...a) },
    from: () => ({
      insert: (...a: any[]) => insert(...a),
      select: (...a: any[]) => select(...a),
    }),
  },
}));

beforeEach(() => {
  rpc.mockReset();
  getUser.mockReset();
  insert.mockReset();
  order.mockReset();
  isFilter.mockReset();
  select.mockReset();
  getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
  insert.mockResolvedValue({ data: null, error: null });
  // listMyAppeals chains .select("*").order(...); listOpenAppeals chains
  // .select(...).is(...).order(...), so select has to hand back both.
  select.mockReturnValue({ order, is: isFilter });
  // listOpenAppeals chains .is(...).order(...), so is has to hand back the order spy.
  isFilter.mockReturnValue({ order });
  order.mockResolvedValue({ data: [], error: null });
});

test("listMyAppeals returns the rows, newest first", async () => {
  const { listMyAppeals } = await import("./appeals");
  order.mockResolvedValue({
    data: [{
      id: "a1", cook_id: "u1", subject_type: "name", subject_id: null,
      body: "it was not me", created_at: "2026-09-28T00:00:00Z",
      resolved_at: null, outcome: null, moderator_note: null,
    }],
    error: null,
  });
  const got = await listMyAppeals();
  expect(got.map((a) => a.id)).toEqual(["a1"]);
  expect(select).toHaveBeenCalledWith("*");
  expect(order).toHaveBeenCalledWith("created_at", { ascending: false });
});

test("listMyAppeals returns an empty list rather than null", async () => {
  const { listMyAppeals } = await import("./appeals");
  order.mockResolvedValue({ data: null, error: null });
  await expect(listMyAppeals()).resolves.toEqual([]);
});

test("listMyAppeals throws the database message", async () => {
  const { listMyAppeals } = await import("./appeals");
  order.mockResolvedValue({ data: null, error: { message: "nope" } });
  await expect(listMyAppeals()).rejects.toThrow("nope");
});

test("createAppeal inserts the current user as cook_id with the body trimmed", async () => {
  const { createAppeal } = await import("./appeals");
  await expect(createAppeal("recipe", "r1", "  it is mine  ")).resolves.toBeUndefined();
  expect(insert).toHaveBeenCalledWith({
    cook_id: "u1", subject_type: "recipe", subject_id: "r1", body: "it is mine",
  });
});

// A name appeal has no recipe: the subject IS the cook, so subject_id is null.
test("createAppeal passes a null subject_id through for a name appeal", async () => {
  const { createAppeal } = await import("./appeals");
  await createAppeal("name", null, "my name is mine");
  expect(insert).toHaveBeenCalledWith({
    cook_id: "u1", subject_type: "name", subject_id: null, body: "my name is mine",
  });
});

test("createAppeal throws Not signed in and never inserts when there is no user", async () => {
  const { createAppeal } = await import("./appeals");
  getUser.mockResolvedValue({ data: { user: null } });
  await expect(createAppeal("name", null, "hello")).rejects.toThrow("Not signed in");
  expect(insert).not.toHaveBeenCalled();
});

// The database check is length(btrim(body)) between 1 and 1000, so whitespace alone is empty.
test("createAppeal refuses an empty or whitespace-only body", async () => {
  const { createAppeal } = await import("./appeals");
  await expect(createAppeal("name", null, "   ")).rejects.toThrow(
    "An appeal needs a few words.",
  );
  expect(insert).not.toHaveBeenCalled();
});

test("createAppeal refuses a body over 1000 characters", async () => {
  const { createAppeal } = await import("./appeals");
  await expect(createAppeal("name", null, "x".repeat(1001))).rejects.toThrow(
    "An appeal can be at most 1000 characters.",
  );
  expect(insert).not.toHaveBeenCalled();
});

// 23505 is the partial unique index refusing a second open appeal for the same subject. The
// index is the only authority on whether one is open: checking first and inserting second is
// a race.
test("createAppeal turns a 23505 into the already-open message", async () => {
  const { createAppeal } = await import("./appeals");
  insert.mockResolvedValue({ data: null, error: { code: "23505", message: "duplicate key" } });
  await expect(createAppeal("recipe", "r1", "mine")).rejects.toThrow(
    "You already have an open appeal for this.",
  );
});

test("createAppeal rethrows any other database message verbatim", async () => {
  const { createAppeal } = await import("./appeals");
  insert.mockResolvedValue({ data: null, error: { code: "42501", message: "row level security" } });
  await expect(createAppeal("recipe", "r1", "mine")).rejects.toThrow("row level security");
});

test("listOpenAppeals selects the recipe title embed and filters on a null resolved_at", async () => {
  const { listOpenAppeals } = await import("./appeals");
  order.mockResolvedValue({
    data: [{
      id: "a1", cook_id: "u2", subject_type: "recipe", subject_id: "r1",
      body: "mine", created_at: "2026-09-28T00:00:00Z",
      resolved_at: null, outcome: null, moderator_note: null,
      recipes: { title: "Dal" },
    }],
    error: null,
  });
  const got = await listOpenAppeals();
  expect(got.map((a) => a.id)).toEqual(["a1"]);
  // The queue shows the recipe title, so the select has to embed it. Without this the page
  // renders "Untitled" for every recipe appeal and nothing else complains.
  // NO cook embed: profiles is readable only to its owner, so an embed would be null on
  // every row. The queue resolves those names through public_cooks instead.
  expect(select).toHaveBeenCalledWith("*, recipes(title)");
  expect(got[0].recipes?.title).toBe("Dal");
  // .is, never .eq: PostgREST renders eq.null as a literal and matches nothing.
  expect(isFilter).toHaveBeenCalledWith("resolved_at", null);
  expect(order).toHaveBeenCalledWith("created_at", { ascending: false });
});

test("listOpenAppeals throws the database message", async () => {
  const { listOpenAppeals } = await import("./appeals");
  order.mockResolvedValue({ data: null, error: { message: "nope" } });
  await expect(listOpenAppeals()).rejects.toThrow("nope");
});

// An empty note is the common case and must land as null, not as an empty string.
test("resolveAppeal calls the rpc with the appeal, outcome and a null note when empty", async () => {
  const { resolveAppeal } = await import("./appeals");
  rpc.mockResolvedValue({ data: null, error: null });
  await expect(resolveAppeal("a1", "granted", "   ")).resolves.toBeUndefined();
  expect(rpc).toHaveBeenCalledWith("resolve_appeal", {
    p_appeal: "a1", p_outcome: "granted", p_note: null,
  });
});

test("resolveAppeal sends a trimmed note", async () => {
  const { resolveAppeal } = await import("./appeals");
  rpc.mockResolvedValue({ data: null, error: null });
  await resolveAppeal("a1", "declined", "  not this time  ");
  expect(rpc).toHaveBeenCalledWith("resolve_appeal", {
    p_appeal: "a1", p_outcome: "declined", p_note: "not this time",
  });
});

test("resolveAppeal throws the rpc message", async () => {
  const { resolveAppeal } = await import("./appeals");
  rpc.mockResolvedValue({ data: null, error: { message: "not a moderator" } });
  await expect(resolveAppeal("a1", "granted", "")).rejects.toThrow("not a moderator");
});
