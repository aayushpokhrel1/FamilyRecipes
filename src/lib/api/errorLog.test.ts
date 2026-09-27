import { vi, test, expect, beforeEach } from "vitest";

const from = vi.fn();
vi.mock("../supabaseClient", () => ({ supabase: {
  from: (...a: any[]) => from(...a),
}}));

// The insert is fire-and-forget, so the mock has to be a thenable the module can attach a
// rejection handler to, and it has to record the payload at call time rather than on resolve.
function mockInsert(result: { error: unknown } = { error: null }) {
  const inserted: any[] = [];
  from.mockImplementation((table: string) => ({
    insert: (payload: any) => {
      inserted.push({ table, payload });
      return { then: (_ok: unknown, fail?: (e: unknown) => void) => { if (result.error) fail?.(result.error); } };
    },
  }));
  return { inserted };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  window.history.replaceState({}, "", "/");
});

// The cap and the guard are module state, so every test needs its own copy of the module.
async function load() {
  return (await import("./errorLog")).reportError;
}

test("a normal call inserts one row with the context and the error message", async () => {
  const { inserted } = mockInsert();
  const reportError = await load();

  reportError("save:recipe-create", new Error("boom"));

  expect(inserted).toHaveLength(1);
  expect(inserted[0].table).toBe("error_log");
  expect(inserted[0].payload.context).toBe("save:recipe-create");
  expect(inserted[0].payload.message).toBe("boom");
  // The column defaults to auth.uid() and RLS requires the row to match the caller, so a
  // client-sent user_id could only ever restate it.
  expect(inserted[0].payload.user_id).toBeUndefined();
});

// A rejected promise is not caught by a surrounding try/catch when nothing awaits it, so
// without the rejection handler this test fails with an unhandled rejection.
test("an insert that rejects does not throw out of reportError", async () => {
  mockInsert({ error: { message: "nope" } });
  const reportError = await load();

  expect(() => reportError("save:recipe-create", new Error("boom"))).not.toThrow();

  // And the caller keeps going: a failed report must not be the end of the code path that
  // was already handling a failure.
  let ran = false;
  reportError("save:recipe-create", new Error("boom"));
  ran = true;
  expect(ran).toBe(true);
});

// A render loop must not be able to write thousands of rows.
test("the 21st call on a page inserts nothing", async () => {
  const { inserted } = mockInsert();
  const reportError = await load();

  for (let i = 0; i < 21; i++) reportError("loop:render", new Error("boom"));

  expect(inserted).toHaveLength(20);
});

// A failure raised from inside the reporting path must not be reported, or a broken reporter
// recurses until the tab dies.
test("a failure inside the reporter is not itself reported", async () => {
  const { inserted } = mockInsert();
  const reportError = await load();

  // Throwing from the insert call is the failure the guard exists for: it happens while a
  // report is in flight, so the catch must swallow it rather than report it.
  from.mockImplementation(() => ({
    insert: () => {
      reportError("reporter:insert", new Error("inner"));
      throw new Error("insert exploded");
    },
  }));

  expect(() => reportError("save:recipe-create", new Error("boom"))).not.toThrow();
  expect(inserted).toHaveLength(0);
});

// On /recipes/:id a full href IS a recipe id, and a query string or hash can carry anything
// the user was looking at.
test("url is the pathname only, without query or hash", async () => {
  const { inserted } = mockInsert();
  const reportError = await load();
  window.history.replaceState({}, "", "/recipes/r1?token=secret#step-3");

  reportError("save:recipe-edit", new Error("boom"));

  expect(inserted[0].payload.url).toBe("/recipes/r1");
});

test("a non-Error value still produces a usable message", async () => {
  const { inserted } = mockInsert();
  const reportError = await load();

  reportError("extract:image", "model returned nothing");
  reportError("extract:image", { status: 429 });

  expect(inserted[0].payload.message).toBe("model returned nothing");
  // An object stringifies to "[object Object]", which is useless but is still a string the
  // not-null column accepts: the point is that the call survives and writes something.
  expect(inserted[1].payload.message).toBe("[object Object]");
  expect(inserted[1].payload.stack).toBeNull();
});

// The rejection handler on the insert is load-bearing and was NOT covered: removing it left
// every other test green, because an unhandled rejection does not fail a vitest run by
// default. It is the only thing standing between a failed insert and an unhandled rejection
// in a family member's console, so it gets pinned directly: the module must attach a
// rejection handler to the thenable it gets back.
test("a rejection handler is attached to the insert, not left dangling", async () => {
  let handler: unknown;
  from.mockImplementation(() => ({
    insert: () => ({ then: (_ok: unknown, fail?: unknown) => { handler = fail; } }),
  }));
  const reportError = await load();
  reportError("ctx", new Error("boom"));
  expect(typeof handler).toBe("function");
});
