import { expect, test, vi, beforeEach } from "vitest";

const rpc = vi.fn();
const getUser = vi.fn();
const insert = vi.fn();
const inFilter = vi.fn();
const order = vi.fn();
const eq = vi.fn();
const select = vi.fn();
const invoke = vi.fn();
vi.mock("../supabaseClient", () => ({
  supabase: {
    rpc: (...a: any[]) => rpc(...a),
    auth: { getUser: (...a: any[]) => getUser(...a) },
    functions: { invoke: (...a: any[]) => invoke(...a) },
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
  inFilter.mockReset();
  order.mockReset();
  eq.mockReset();
  select.mockReset();
  invoke.mockReset();
  invoke.mockResolvedValue({ data: null, error: null });
  getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
  // myReportedIds chains .select(...).in(...); listOpenReports chains
  // .select(...).eq(...).order(...), so select has to hand back both.
  select.mockReturnValue({ in: inFilter, eq });
  // listOpenReports chains .eq(...).order(...), so eq has to hand back the order spy.
  eq.mockReturnValue({ order });
  // reportRecipe chains .insert(...).select("id").single() so the nudge can name the report.
  insert.mockReturnValue({
    select: () => ({ single: () => Promise.resolve({ data: { id: "rep1" }, error: null }) }),
  });
});

test("reportRecipe sends the current user as reporter_id", async () => {
  const { reportRecipe } = await import("./moderation");
  // insert now chains, so the default chain from beforeEach is what resolves
  await expect(reportRecipe("r1", "offensive", "rude")).resolves.toBeUndefined();
  expect(insert).toHaveBeenCalledWith({
    recipe_id: "r1", reporter_id: "u1", reason: "offensive", note: "rude",
  });
});

// An empty note is the common case and must land as null, not as an empty string.
test("reportRecipe sends an empty note as null", async () => {
  const { reportRecipe } = await import("./moderation");
  // insert now chains, so the default chain from beforeEach is what resolves
  await reportRecipe("r1", "other", "   ");
  expect(insert).toHaveBeenCalledWith({
    recipe_id: "r1", reporter_id: "u1", reason: "other", note: null,
  });
});

test("reportRecipe throws the database message", async () => {
  const { reportRecipe } = await import("./moderation");
  insert.mockReturnValue({
    select: () => ({
      single: () => Promise.resolve({
        data: null, error: { message: "reports_one_open_per_reporter" },
      }),
    }),
  });
  await expect(reportRecipe("r1", "offensive", "")).rejects.toThrow(
    "reports_one_open_per_reporter",
  );
});

// A cook report names a cook, so it must NOT carry a recipe_id key at all: the database
// check is num_nonnulls(recipe_id, cook_id) = 1, and an explicit null would still be a key
// the insert policy has to reason about. Absent, not null.
test("reportCook inserts with cook_id and no recipe_id key", async () => {
  const { reportCook } = await import("./moderation");
  await expect(reportCook("cook-1", "impersonation", "pretends to be me")).resolves.toBeUndefined();
  expect(insert).toHaveBeenCalledWith({
    cook_id: "cook-1", reporter_id: "u1", reason: "impersonation", note: "pretends to be me",
  });
  expect(insert.mock.calls[0][0]).not.toHaveProperty("recipe_id");
});

test("reportCook sends an empty note as null", async () => {
  const { reportCook } = await import("./moderation");
  await reportCook("cook-1", "other", "   ");
  expect(insert).toHaveBeenCalledWith({
    cook_id: "cook-1", reporter_id: "u1", reason: "other", note: null,
  });
});

test("reportCook throws the database message", async () => {
  const { reportCook } = await import("./moderation");
  insert.mockReturnValue({
    select: () => ({
      single: () => Promise.resolve({
        data: null, error: { message: "reports_one_open_cook_per_reporter" },
      }),
    }),
  });
  await expect(reportCook("cook-1", "impersonation", "")).rejects.toThrow(
    "reports_one_open_cook_per_reporter",
  );
});

// Same best-effort rule as reportRecipe: the row is the record, the email is a nudge.
test("a failing notify-report does not fail a cook report", async () => {
  const { reportCook } = await import("./moderation");
  invoke.mockRejectedValue(new Error("function is down"));
  await expect(reportCook("cook-1", "impersonation", "")).resolves.toBeUndefined();
  expect(insert).toHaveBeenCalledTimes(1);
});

// One call for the whole page, never one per card. Potluck already holds this rule for
// bylines and saves, and it is pinned by a test there for the same reason.
test("myReportedIds asks once for every id and returns a set", async () => {
  const { myReportedIds } = await import("./moderation");
  inFilter.mockResolvedValue({ data: [{ recipe_id: "a" }, { recipe_id: "c" }], error: null });
  const got = await myReportedIds(["a", "b", "c"]);
  expect(got).toEqual(new Set(["a", "c"]));
  expect(inFilter).toHaveBeenCalledTimes(1);
  expect(inFilter).toHaveBeenCalledWith("recipe_id", ["a", "b", "c"]);
});

test("myReportedIds does not query at all for an empty list", async () => {
  const { myReportedIds } = await import("./moderation");
  const got = await myReportedIds([]);
  expect(got).toEqual(new Set());
  expect(inFilter).not.toHaveBeenCalled();
});

test("myReportedIds throws the database message", async () => {
  const { myReportedIds } = await import("./moderation");
  inFilter.mockResolvedValue({ data: null, error: { message: "nope" } });
  await expect(myReportedIds(["a"])).rejects.toThrow("nope");
});

test("listOpenReports filters to open reports, newest first", async () => {
  const { listOpenReports } = await import("./moderation");
  order.mockResolvedValue({
    data: [{ id: "rep1", recipe_id: "r1", reporter_id: "u2", reason: "offensive",
             note: null, status: "open", created_at: "2026-09-28T00:00:00Z",
             recipes: { title: "Dal" } }],
    error: null,
  });
  const got = await listOpenReports();
  expect(got.map((r) => r.id)).toEqual(["rep1"]);
  // The queue shows the recipe title, so the select has to embed it. Without this the
  // page renders "Untitled" for every row and nothing else complains.
  // NO cook embed: profiles is readable only to its owner, so an embed would be null on
  // every cook report. The queue resolves those names through public_cooks instead.
  expect(select).toHaveBeenCalledWith("*, recipes(title)");
  expect(got[0].recipes?.title).toBe("Dal");
  expect(eq).toHaveBeenCalledWith("status", "open");
  expect(order).toHaveBeenCalledWith("created_at", { ascending: false });
});

test("listOpenReports throws the database message", async () => {
  const { listOpenReports } = await import("./moderation");
  order.mockResolvedValue({ data: null, error: { message: "nope" } });
  await expect(listOpenReports()).rejects.toThrow("nope");
});

test("resolveReport calls the rpc with the report, action and reason", async () => {
  const { resolveReport } = await import("./moderation");
  rpc.mockResolvedValue({ data: null, error: null });
  await expect(resolveReport("rep1", "unpublish", "offensive")).resolves.toBeUndefined();
  expect(rpc).toHaveBeenCalledWith("resolve_report", {
    p_report_id: "rep1", p_action: "unpublish", p_reason: "offensive",
  });
});

test("resolveReport throws the database message", async () => {
  const { resolveReport } = await import("./moderation");
  rpc.mockResolvedValue({ data: null, error: { message: "not a moderator" } });
  await expect(resolveReport("rep1", "dismiss", "other")).rejects.toThrow("not a moderator");
});

// The email is a nudge, never the record. If notify-report is down, or the user's tab is
// offline, the report must still have been filed: this is the whole point of best-effort and
// it is the kind of thing a later refactor quietly turns into an await that throws.
test("a failing notify-report does not fail the report", async () => {
  const { reportRecipe } = await import("./moderation");
  invoke.mockRejectedValue(new Error("function is down"));
  await expect(reportRecipe("r1", "offensive", "")).resolves.toBeUndefined();
  expect(insert).toHaveBeenCalledTimes(1);
});

// THE BUG, pinned: the notify is awaited nowhere. It used to be awaited, and when the
// function was slow or missing the report was already written while the button still read
// "Report", so the obvious next move was to click again and hit the duplicate-report error.
// A promise that never settles must not hold up either report.
test("a report resolves even when the notify never settles", async () => {
  const { reportRecipe, reportCook } = await import("./moderation");
  invoke.mockImplementation(() => new Promise(() => {}));
  await expect(reportRecipe("r1", "offensive", "")).resolves.toBeUndefined();
  await expect(reportCook("c1", "impersonation", "")).resolves.toBeUndefined();
  expect(invoke).toHaveBeenCalledTimes(2);
});
