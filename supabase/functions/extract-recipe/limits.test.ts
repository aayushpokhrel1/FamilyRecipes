import { describe, it, expect } from "vitest";
import { MAX_PAYLOAD, MAX_FETCH_BYTES, payloadTooLarge, checkUrl, fetchCapped } from "./limits";

// A plain stub function passed as deps.fetch, no mocking framework: the same arrangement as
// retry.test.ts, so these tests never touch the network.
function stubFetch(routes: Record<string, () => Response>) {
  const seen: string[] = [];
  const fn = (async (input: string | URL | Request) => {
    const key = String(input);
    seen.push(key);
    const route = routes[key];
    if (!route) throw new Error(`unexpected fetch: ${key}`);
    return route();
  }) as unknown as typeof fetch;
  return { fn, seen };
}

const html = (body: string) => new Response(body, { headers: { "content-type": "text/html" } });

describe("MAX_PAYLOAD", () => {
  // Pinned because these are the numbers the brief and the comments promise, and a quiet
  // edit to one of them is exactly the kind of change that would let a hostile payload back
  // in without any test going red.
  it("keeps the documented limits, with image and audio far larger than text", () => {
    expect(MAX_PAYLOAD).toEqual({ text: 100_000, url: 2_000, image: 10_000_000, audio: 10_000_000 });
    expect(MAX_PAYLOAD.image).toBeGreaterThan(MAX_PAYLOAD.text);
    expect(MAX_PAYLOAD.audio).toBeGreaterThan(MAX_PAYLOAD.text);
  });
});

describe("payloadTooLarge", () => {
  it("lets a normal recipe-sized paste through", () => {
    const recipe = "Ingredients\n2 cups flour\n1 tsp salt\n\nMix and bake for 30 minutes.";
    expect(payloadTooLarge("text", recipe)).toBeNull();
  });

  it("refuses a 200k-character paste, which is not a recipe", () => {
    const problem = payloadTooLarge("text", "x".repeat(200_000));
    expect(problem).not.toBeNull();
    expect(problem).toMatch(/too long/i);
    expect(problem).toMatch(/by hand/i);
  });

  // THE HONEST CASE a careless cap would break: a phone photo is sent as a base64 data URL
  // WITHOUT being shrunk first, so 6MB of JPEG is roughly 8 million characters of payload.
  it("lets a 6MB base64 photo through, because that is a normal phone photo", () => {
    const photo = "data:image/jpeg;base64," + "A".repeat(8_000_000);
    expect(photo.length).toBeGreaterThan(6_000_000);
    expect(payloadTooLarge("image", photo)).toBeNull();
  });

  it("refuses a photo past the cap, and says so in words a cook can act on", () => {
    const problem = payloadTooLarge("image", "A".repeat(MAX_PAYLOAD.image + 1));
    expect(problem).not.toBeNull();
    expect(problem).toMatch(/picture/i);
    expect(problem).toMatch(/by hand/i);
  });

  it("refuses an over-long link, since no real address is that long", () => {
    expect(payloadTooLarge("url", "https://example.com/" + "a".repeat(3_000))).not.toBeNull();
  });

  it("holds an unknown mode to the text limit rather than to no limit at all", () => {
    expect(payloadTooLarge("video", "x".repeat(MAX_PAYLOAD.text + 1))).not.toBeNull();
    expect(payloadTooLarge("video", "x".repeat(MAX_PAYLOAD.text))).toBeNull();
  });

  it("accepts a payload exactly at the limit, so the boundary is not off by one", () => {
    expect(payloadTooLarge("text", "x".repeat(MAX_PAYLOAD.text))).toBeNull();
    expect(payloadTooLarge("text", "x".repeat(MAX_PAYLOAD.text + 1))).not.toBeNull();
  });
});

describe("checkUrl", () => {
  it("accepts an ordinary public recipe link", () => {
    const got = checkUrl("https://example.com/recipe");
    expect(got.ok).toBe(true);
    if (got.ok) expect(got.url.hostname).toBe("example.com");
  });

  it("accepts plain http too, since plenty of recipe blogs still use it", () => {
    expect(checkUrl("http://example.com/recipe").ok).toBe(true);
  });

  // Each of these is a way to make the function read something the caller cannot reach
  // themselves, which is the whole hole this file exists to close.
  it("refuses a file URL, which would read the server's own disk", () => {
    expect(checkUrl("file:///etc/passwd").ok).toBe(false);
  });

  it("refuses localhost, which is the function's own machine", () => {
    expect(checkUrl("http://localhost:54321").ok).toBe(false);
  });

  it("refuses the loopback address", () => {
    expect(checkUrl("http://127.0.0.1").ok).toBe(false);
  });

  it("refuses the cloud metadata address, which hands out credentials", () => {
    expect(checkUrl("http://169.254.169.254/latest/meta-data/").ok).toBe(false);
  });

  it("refuses a home router address", () => {
    expect(checkUrl("http://192.168.1.1").ok).toBe(false);
  });

  it("refuses a private 10.x address", () => {
    expect(checkUrl("http://10.0.0.5").ok).toBe(false);
  });

  it("refuses IPv6 loopback, brackets and all", () => {
    expect(checkUrl("http://[::1]/").ok).toBe(false);
  });

  // A trailing dot is the root-anchored form of the same name and resolves to the same
  // machine, and the URL parser keeps it on a domain. Without the strip in checkUrl every
  // one of these passed the check, which is a known way SSRF guards get walked around. These
  // three were watched failing before the strip was added.
  it("refuses the trailing-dot form of every name it blocks", () => {
    for (const raw of [
      "http://localhost./",
      "http://thing.internal./",
      "http://metadata.google.internal./",
    ]) {
      const result = checkUrl(raw);
      expect(result.ok, raw).toBe(false);
    }
  });

  it("refuses an internal-only hostname", () => {
    expect(checkUrl("http://thing.internal").ok).toBe(false);
  });

  it("refuses a string that is not a URL at all", () => {
    const got = checkUrl("not a url");
    expect(got.ok).toBe(false);
    if (!got.ok) expect(got.reason).toBeTruthy();
  });

  it("refuses the other internal shapes too, so the list is not just the famous ones", () => {
    for (const raw of [
      "http://LOCALHOST/",
      "http://api.localhost/",
      "http://printer.local/",
      "http://metadata.google.internal/computeMetadata/v1/",
      "http://172.16.0.1/",
      "http://172.31.255.254/",
      "http://0.0.0.0/",
      "http://[fd00::1]/",
      "http://[fe80::1]/",
      "data:text/html,<h1>hi</h1>",
      "gopher://example.com/",
    ]) {
      expect(checkUrl(raw).ok, raw).toBe(false);
    }
  });

  it("does not refuse a public address that merely looks similar", () => {
    for (const raw of ["https://example.com/recipe", "http://172.32.0.1/", "http://11.0.0.1/", "http://[2606:4700::1111]/"]) {
      expect(checkUrl(raw).ok, raw).toBe(true);
    }
  });

  it("always gives a reason a cook could read", () => {
    for (const raw of ["file:///etc/passwd", "http://127.0.0.1", "nonsense"]) {
      const got = checkUrl(raw);
      expect(got.ok).toBe(false);
      if (!got.ok) {
        expect(got.reason).toMatch(/^[A-Z].*\.$/);
        expect(got.reason).not.toMatch(/undefined|\[object/i);
      }
    }
  });
});

describe("fetchCapped", () => {
  it("returns the whole body when it is small", async () => {
    const { fn } = stubFetch({ "https://example.com/recipe": () => html("<h1>Dal</h1>") });
    const body = await fetchCapped(new URL("https://example.com/recipe"), { fetch: fn });
    expect(body).toBe("<h1>Dal</h1>");
  });

  // Truncating beats failing: a recipe's text is near the top of the page, so half a page is
  // usually still a usable extraction, where a hard failure is always a dead end.
  it("truncates a body larger than the cap instead of throwing", async () => {
    const big = "x".repeat(MAX_FETCH_BYTES * 2);
    const { fn } = stubFetch({ "https://example.com/huge": () => html(big) });
    const body = await fetchCapped(new URL("https://example.com/huge"), { fetch: fn });
    expect(body.length).toBeLessThanOrEqual(MAX_FETCH_BYTES);
    expect(body.length).toBeGreaterThan(0);
  });

  it("follows one redirect to a public address and returns the final body", async () => {
    const { fn, seen } = stubFetch({
      "https://example.com/old": () => new Response("", { status: 301, headers: { location: "https://example.com/new" } }),
      "https://example.com/new": () => html("<h1>Momo</h1>"),
    });
    const body = await fetchCapped(new URL("https://example.com/old"), { fetch: fn });
    expect(body).toBe("<h1>Momo</h1>");
    expect(seen).toEqual(["https://example.com/old", "https://example.com/new"]);
  });

  it("resolves a relative redirect against the page it came from", async () => {
    const { fn, seen } = stubFetch({
      "https://example.com/old": () => new Response("", { status: 302, headers: { location: "/new" } }),
      "https://example.com/new": () => html("ok"),
    });
    expect(await fetchCapped(new URL("https://example.com/old"), { fetch: fn })).toBe("ok");
    expect(seen[1]).toBe("https://example.com/new");
  });

  // THE TEST THAT MATTERS MOST: this is the hole a host check on the original URL alone
  // leaves open. The first URL is perfectly public, and it is the redirect that reaches the
  // function's own machine.
  it("refuses a redirect that points at 127.0.0.1, and says why", async () => {
    const { fn, seen } = stubFetch({
      "https://example.com/evil": () => new Response("", { status: 302, headers: { location: "http://127.0.0.1/" } }),
    });
    await expect(fetchCapped(new URL("https://example.com/evil"), { fetch: fn }))
      .rejects.toThrow(/not a public web address/i);
    // and it never fetched the private address
    expect(seen).toEqual(["https://example.com/evil"]);
  });

  it("refuses a redirect to the cloud metadata address too", async () => {
    const { fn } = stubFetch({
      "https://example.com/evil": () => new Response("", { status: 302, headers: { location: "http://169.254.169.254/latest/meta-data/" } }),
    });
    await expect(fetchCapped(new URL("https://example.com/evil"), { fetch: fn })).rejects.toThrow(/not a public web address/i);
  });

  it("gives up when a link bounces us around more times than we will follow", async () => {
    const { fn } = stubFetch({
      "https://example.com/1": () => new Response("", { status: 302, headers: { location: "https://example.com/2" } }),
      "https://example.com/2": () => new Response("", { status: 302, headers: { location: "https://example.com/3" } }),
      "https://example.com/3": () => new Response("", { status: 302, headers: { location: "https://example.com/4" } }),
      "https://example.com/4": () => new Response("", { status: 302, headers: { location: "https://example.com/5" } }),
    });
    await expect(fetchCapped(new URL("https://example.com/1"), { fetch: fn })).rejects.toThrow(/too many times/i);
  });

  it("still returns the body when the response has no streaming body to read", async () => {
    const { fn } = stubFetch({
      "https://example.com/plain": () => ({ text: async () => "y".repeat(MAX_FETCH_BYTES + 500), body: null }) as unknown as Response,
    });
    const body = await fetchCapped(new URL("https://example.com/plain"), { fetch: fn });
    expect(body.length).toBe(MAX_FETCH_BYTES);
  });
});
