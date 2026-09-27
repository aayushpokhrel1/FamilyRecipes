import { test, expect, vi } from "vitest";
import { checkExtract, HEALTH_PATH } from "./health";

const URL_BASE = "https://project.supabase.co";
const ok = (status: number) => new Response(null, { status });

test("a booted function answers the preflight, so the check passes", async () => {
  const fetchImpl = vi.fn().mockResolvedValue(ok(204));
  const res = await checkExtract(URL_BASE, fetchImpl as unknown as typeof fetch);
  expect(res.status).toBe(200);
});

// The failure this whole route exists for: on 2026-09-27 a syntax error left the function
// unparseable and every request answered 503 BOOT_ERROR.
test("a function that will not boot fails the check", async () => {
  const fetchImpl = vi.fn().mockResolvedValue(ok(503));
  const res = await checkExtract(URL_BASE, fetchImpl as unknown as typeof fetch);
  expect(res.status).toBe(503);
  expect(await res.text()).toContain("503");
});

// The blind spot that made this route necessary in the first place. A monitor pointed straight
// at the function gets 401 from the gateway whether the function is alive or dead, so a 401
// must never be read as healthy here, or the same hole is rebuilt one layer up.
test("a 401 is a failure, never a pass", async () => {
  const fetchImpl = vi.fn().mockResolvedValue(ok(401));
  const res = await checkExtract(URL_BASE, fetchImpl as unknown as typeof fetch);
  expect(res.status).toBe(503);
});

test("an unreachable function fails rather than passing quietly", async () => {
  const fetchImpl = vi.fn().mockRejectedValue(new Error("timed out"));
  const res = await checkExtract(URL_BASE, fetchImpl as unknown as typeof fetch);
  expect(res.status).toBe(503);
  expect(await res.text()).toBe("unreachable");
});

// OPTIONS is load-bearing: it is answered above the function's auth check, which is why this
// works with no credential. A GET or POST here would be rejected by the gateway and the check
// would fail forever.
test("it probes with OPTIONS, at the function's url, carrying no credential", async () => {
  const fetchImpl = vi.fn().mockResolvedValue(ok(204));
  await checkExtract(URL_BASE, fetchImpl as unknown as typeof fetch);
  const [url, init] = fetchImpl.mock.calls[0];
  expect(url).toBe(`${URL_BASE}/functions/v1/extract-recipe`);
  expect(init.method).toBe("OPTIONS");
  expect(init.headers).toBeUndefined();
});

// A cached "ok" is a monitor that cannot see an outage.
test("the answer is never cached", async () => {
  const fetchImpl = vi.fn().mockResolvedValue(ok(204));
  const res = await checkExtract(URL_BASE, fetchImpl as unknown as typeof fetch);
  expect(res.headers.get("cache-control")).toBe("no-store");
});

test("the path is the one the monitor is pointed at", () => {
  expect(HEALTH_PATH).toBe("/health/extract");
});
