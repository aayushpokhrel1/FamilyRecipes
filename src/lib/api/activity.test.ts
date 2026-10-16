import activitySource from "./activity.ts?raw";
import { vi, test, expect, beforeEach, afterEach } from "vitest";

const from = vi.fn();
const rpc = vi.fn();
vi.mock("../supabaseClient", () => ({ supabase: {
  from: (...a: any[]) => from(...a),
  rpc: (...a: any[]) => rpc(...a),
}}));

// The write is fire-and-forget, so the mock has to be a thenable the module can attach a
// rejection handler to, and it has to record the arguments at call time rather than on
// resolve. It records an RPC rather than a table write because `on conflict` needs a select
// policy and this table deliberately has none; 0060 has the reasoning.
function mockRpc(result: { error: unknown } = { error: null }) {
  const calls: { fn: string; args: any }[] = [];
  rpc.mockImplementation((fn: string, args: any) => {
    calls.push({ fn, args });
    return { then: (_ok: unknown, fail?: (e: unknown) => void) => { if (result.error) fail?.(result.error); } };
  });
  return { calls };
}

beforeEach(() => {
  vi.clearAllMocks();
  // The dedupe set is module state, so every test needs its own copy of the module.
  vi.resetModules();
});

afterEach(() => {
  vi.useRealTimers();
});

// surfaceFor is pure, so it can be imported once and called directly.
async function loadSurfaceFor() {
  return (await import("./activity")).surfaceFor;
}

// recordVisit touches module state, so it gets a fresh module per test.
async function loadRecordVisit() {
  return (await import("./activity")).recordVisit;
}

test("surfaceFor maps each route to its surface", async () => {
  const surfaceFor = await loadSurfaceFor();

  expect(surfaceFor("/")).toBe("recipes");
  expect(surfaceFor("/recipes/new")).toBe("recipes");
  expect(surfaceFor("/recipes/abc-123")).toBe("recipes");
  expect(surfaceFor("/recipes/abc/edit")).toBe("recipes");
  // Cook mode is the feature being measured, so it is NOT "recipes".
  expect(surfaceFor("/recipes/abc/cook")).toBe("cookmode");
  expect(surfaceFor("/families")).toBe("families");
  expect(surfaceFor("/families/anything")).toBe("families");
  expect(surfaceFor("/potluck")).toBe("potluck");
  expect(surfaceFor("/kitchen")).toBe("kitchen");
  expect(surfaceFor("/kitchen/abc-123")).toBe("kitchen");
  // More specific than /kitchen/:id, so it wins.
  expect(surfaceFor("/kitchen/cupboard")).toBe("cupboard");
  expect(surfaceFor("/drafts")).toBe("drafts");
  expect(surfaceFor("/settings")).toBe("settings");
  expect(surfaceFor("/me")).toBe("profile");
  expect(surfaceFor("/cooks/somehandle")).toBe("profile");
  expect(surfaceFor("/moderation")).toBe("moderation");
});

test("surfaceFor returns null for everything that is not a surface", async () => {
  const surfaceFor = await loadSurfaceFor();

  expect(surfaceFor("/signin")).toBeNull();
  expect(surfaceFor("/signup")).toBeNull();
  expect(surfaceFor("/auth/callback")).toBeNull();
  expect(surfaceFor("/terms")).toBeNull();
  expect(surfaceFor("/privacy")).toBeNull();
  expect(surfaceFor("/cookies")).toBeNull();
  expect(surfaceFor("/help")).toBeNull();
  expect(surfaceFor("/join/CODE")).toBeNull();
  expect(surfaceFor("/recover")).toBeNull();
  expect(surfaceFor("/nope/not-a-page")).toBeNull();
});

// "/" is the INDEX route and renders RecipeList, so no segments means "recipes" rather than
// nothing. react-router never hands over the empty string, since a pathname is always at
// least "/", which is why the two are not distinguished.
test("surfaceFor reads the index route as recipes", async () => {
  const surfaceFor = await loadSurfaceFor();
  expect(surfaceFor("/")).toBe("recipes");
  expect(surfaceFor("")).toBe("recipes");
});

test("surfaceFor ignores a leading or trailing slash", async () => {
  const surfaceFor = await loadSurfaceFor();

  expect(surfaceFor("potluck")).toBe("potluck");
  expect(surfaceFor("/potluck/")).toBe("potluck");
  expect(surfaceFor("potluck/")).toBe("potluck");
  expect(surfaceFor("recipes/abc/cook/")).toBe("cookmode");
  expect(surfaceFor("kitchen/cupboard/")).toBe("cupboard");
  expect(surfaceFor("/")).toBe("recipes");
});

test("recordVisit calls record_visit with the day and the surface, and names no cook", async () => {
  const { calls } = mockRpc();
  const recordVisit = await loadRecordVisit();

  recordVisit("/potluck");

  expect(calls).toHaveLength(1);
  expect(calls[0].fn).toBe("record_visit");
  // THE COOK IS NOT NAMED. The function reads auth.uid() itself, so this call cannot attribute
  // a visit to anybody, which is stronger than a policy refusing it when it tries. Anything
  // resembling a user id in these arguments is the regression to catch.
  expect(Object.keys(calls[0].args).sort()).toEqual(["p_day", "p_surface"]);
  expect(calls[0].args.p_surface).toBe("potluck");
});

// An RPC rather than a table write, because `on conflict` needs a select policy (Postgres has
// to look at the conflicting row) and this table deliberately has none. 0060 has the long
// version. Pinned so a future tidy-up back to a client upsert fails here rather than in
// production, where recordVisit swallows every error.
test("recordVisit never writes to the table directly", async () => {
  mockRpc();
  const recordVisit = await loadRecordVisit();

  recordVisit("/potluck");

  expect(from).not.toHaveBeenCalled();
});

test("recordVisit writes nothing for a pathname that maps to null", async () => {
  const { calls } = mockRpc();
  const recordVisit = await loadRecordVisit();

  recordVisit("/signin");
  recordVisit("/terms");
  recordVisit("/join/CODE");
  recordVisit("/nope/not-a-page");

  expect(calls).toHaveLength(0);
});

test("recordVisit sends only one upsert for the same surface on the same day", async () => {
  const { calls } = mockRpc();
  const recordVisit = await loadRecordVisit();

  recordVisit("/potluck");
  recordVisit("/potluck");

  expect(calls).toHaveLength(1);
});

test("recordVisit records a different surface on the same day", async () => {
  const { calls } = mockRpc();
  const recordVisit = await loadRecordVisit();

  recordVisit("/potluck");
  recordVisit("/kitchen");

  expect(calls.map((c) => c.args.p_surface)).toEqual(["potluck", "kitchen"]);
});

// The day is the LOCAL date, built from the local getters, because that is what the app means
// by "today" and what the table's check constraint (yesterday, today, tomorrow) is written
// against. toISOString() converts to UTC, so local midnight in any UTC+ timezone reports the
// previous day. The instant below is chosen so the two disagree in the test runner's own
// timezone: 23:30Z is the next day east of UTC, and 00:30Z is the previous day west of it.
test("the day sent is the local date, not the UTC one", async () => {
  const { calls } = mockRpc();
  const recordVisit = await loadRecordVisit();
  // Whichever side of UTC the runner is on, one of these two instants has a local date that
  // differs from its UTC date, so a toISOString()-derived day cannot pass both. The instant is
  // built BEFORE the fake clock is installed, so it is a plain value.
  const offsetMinutes = new Date().getTimezoneOffset();
  const instant = new Date(offsetMinutes < 0 ? "2026-06-01T23:30:00Z" : "2026-06-02T00:30:00Z");
  vi.useFakeTimers();
  vi.setSystemTime(instant);

  recordVisit("/potluck");

  const now = new Date();
  const local = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  expect(calls[0].args.p_day).toBe(local);
  // The instant really does fall on a different date in UTC, so the assertion above is not
  // passing by accident. A runner at UTC offset 0 has no local/UTC difference to show, so the
  // check is skipped there rather than weakened.
  if (offsetMinutes !== 0) {
    expect(calls[0].args.p_day).not.toBe(now.toISOString().slice(0, 10));
  }
});

// A rejected promise is not caught by a surrounding try/catch when nothing awaits it, so
// without the rejection handler this test fails with an unhandled rejection.
test("a write that rejects does not throw out of recordVisit", async () => {
  mockRpc({ error: { message: "nope" } });
  const recordVisit = await loadRecordVisit();

  expect(() => recordVisit("/potluck")).not.toThrow();

  // And the caller keeps going: a failed measurement must not be the end of the navigation.
  let ran = false;
  recordVisit("/kitchen");
  ran = true;
  expect(ran).toBe(true);
});

// The rejection handler is load-bearing and would otherwise be uncovered: removing it leaves
// every other test green, because an unhandled rejection does not fail a vitest run by
// default. It is the only thing standing between a failed write and an unhandled rejection in
// a family member's console, so it gets pinned directly.
test("a rejection handler is attached to the write, not left dangling", async () => {
  let handler: unknown;
  rpc.mockImplementation(() => ({
    then: (_ok: unknown, fail?: unknown) => { handler = fail; },
  }));
  const recordVisit = await loadRecordVisit();

  recordVisit("/potluck");

  expect(typeof handler).toBe("function");
});

// THE TEST ABOVE CANNOT RUN IN CI, and this one is why that is not left as a gap. A runner at
// UTC offset 0 has no local/UTC difference to observe, so no instant can distinguish a local
// day from a toISOString() one there, however the test is written, and CI runs in UTC. So the
// rule is also held mechanically, by reading the source: the same shape as rls.test.ts and
// browserStorage.test.ts, and the only form that is timezone-independent.
test("the day is never derived from toISOString, which is the UTC trap", () => {
  // Vite's ?raw, not node:fs. tsconfig.app.json deliberately has no node types, because app
  // code must not be able to reach for process or fs, and a test living in src/ is covered by
  // that same project. sourceFiles.ts says so in as many words, and browserStorage.test.ts
  // and accessibility.test.ts read this codebase the same way.
  const source: string = activitySource;
  // Comment lines are stripped first, because the implementation's own comment NAMES
  // toISOString to explain why it is not used, and a guard that the explanation trips is a
  // guard nobody can keep green.
  const code = source
    .split(/\r?\n/)
    .filter((line: string) => !line.trimStart().startsWith("//"))
    .join(" ");
  expect(code).not.toContain("toISOString");
});

// The signed-out case is NOT handled in the client on purpose: record_visit() returns early
// when auth.uid() is null, so this module does not need to know who is signed in, and a check
// here would be a second opinion about it that can disagree with the real one.
