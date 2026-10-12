import { test, expect, vi, describe, it } from "vitest";
import { checkExtract, checkVersion, HEALTH_PATH } from "./health";

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

describe("checkVersion", () => {
  const asset = (body: string, ok = true) =>
    () => Promise.resolve(new Response(body, { status: ok ? 200 : 404 }));

  it("serves the stamped commit", async () => {
    const r = await checkVersion(asset("9f8c1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f"));
    expect(await r.text()).toBe("9f8c1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f");
    expect(r.status).toBe(200);
  });

  it("accepts a short sha and the local dev stamp", async () => {
    expect(await (await checkVersion(asset("a1b2c3d"))).text()).toBe("a1b2c3d");
    expect(await (await checkVersion(asset("dev"))).text()).toBe("dev");
  });

  it("trims trailing whitespace a writer may leave", async () => {
    expect(await (await checkVersion(asset("a1b2c3d\n"))).text()).toBe("a1b2c3d");
  });

  // THE one that matters. not_found_handling is "single-page-application", so a missing asset
  // comes back as index.html with a 200, not a 404. Without the shape check this route would
  // publish the whole SPA shell as its version and CI would compare a commit against an HTML
  // document, which never matches but says nothing about why.
  it("refuses the SPA shell that a missing asset returns with a 200", async () => {
    const shell = '<!doctype html><html><head><title>Family Recipes</title></head><body></body></html>';
    expect(await (await checkVersion(asset(shell))).text()).toBe("unknown");
  });

  it("is unknown when the asset is absent or the fetch throws", async () => {
    expect(await (await checkVersion(asset("whatever", false))).text()).toBe("unknown");
    expect(await (await checkVersion(() => Promise.reject(new Error("boom")))).text()).toBe("unknown");
  });

  // A cached version string is a lie about what is deployed, and this route exists to be
  // trusted when everything else looks fine.
  it("is never cached", async () => {
    const r = await checkVersion(asset("a1b2c3d"));
    expect(r.headers.get("Cache-Control")).toBe("no-store");
  });
});
