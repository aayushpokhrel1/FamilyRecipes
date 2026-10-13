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

// Added after the 2026-10-12 audit. checkUrl's IPv6 handling was three prefix tests
// (`::1`, `fc`/`fd`, `fe80`) against the hostname as the URL parser hands it over, and the
// parser does not hand over what was typed. Every case below reached the metadata address
// or the loopback interface through a check whose own comment said it stopped exactly that.
describe("checkUrl, IPv4 written as an IPv6 literal", () => {
  // THE BYPASS THAT MATTERED. `new URL("http://[::ffff:169.254.169.254]/").hostname` is
  // "[::ffff:a9fe:a9fe]": the parser rewrites the dotted quad into hex, so the IPv4 branch
  // never matched it and none of the three IPv6 prefixes did either.
  it("rejects the metadata address wrapped in a mapped IPv6 literal", () => {
    expect(checkUrl("http://[::ffff:169.254.169.254]/latest/meta-data/").ok).toBe(false);
    expect(checkUrl("http://[::ffff:a9fe:a9fe]/latest/meta-data/").ok).toBe(false);
  });

  it("rejects loopback wrapped in a mapped IPv6 literal", () => {
    expect(checkUrl("http://[::ffff:127.0.0.1]/").ok).toBe(false);
    expect(checkUrl("http://[::ffff:7f00:1]/").ok).toBe(false);
  });

  it("rejects a private range wrapped in a mapped IPv6 literal", () => {
    expect(checkUrl("http://[::ffff:10.0.0.1]/").ok).toBe(false);
    expect(checkUrl("http://[::ffff:192.168.1.1]/").ok).toBe(false);
  });

  it("rejects the unspecified address, which connects to the local machine", () => {
    expect(checkUrl("http://[::]/").ok).toBe(false);
    expect(checkUrl("http://0.0.0.0/").ok).toBe(false);
  });

  it("still allows a real public IPv6 host", () => {
    expect(checkUrl("http://[2606:4700:4700::1111]/").ok).toBe(true);
  });
});

describe("checkUrl, the IPv4 ranges that were missing", () => {
  it("rejects carrier-grade NAT, 100.64.0.0/10", () => {
    expect(checkUrl("http://100.64.0.1/").ok).toBe(false);
    expect(checkUrl("http://100.127.255.254/").ok).toBe(false);
  });

  it("rejects IETF protocol assignments, 192.0.0.0/24", () => {
    expect(checkUrl("http://192.0.0.1/").ok).toBe(false);
  });

  it("rejects benchmarking space, 198.18.0.0/15", () => {
    expect(checkUrl("http://198.18.0.1/").ok).toBe(false);
    expect(checkUrl("http://198.19.255.254/").ok).toBe(false);
  });

  it("rejects multicast and reserved space", () => {
    expect(checkUrl("http://224.0.0.1/").ok).toBe(false);
    expect(checkUrl("http://255.255.255.255/").ok).toBe(false);
  });

  it("does not reject the public addresses that neighbour those ranges", () => {
    // 100.63 and 100.128 sit either side of carrier-grade NAT, 198.17 and 198.20 either side
    // of benchmarking space, and 192.0.1 is one block past protocol assignments. An
    // off-by-one in a denylist is a broken feature, not a safe default.
    expect(checkUrl("http://100.63.255.254/").ok).toBe(true);
    expect(checkUrl("http://100.128.0.1/").ok).toBe(true);
    expect(checkUrl("http://198.17.255.254/").ok).toBe(true);
    expect(checkUrl("http://198.20.0.1/").ok).toBe(true);
    expect(checkUrl("http://192.0.1.1/").ok).toBe(true);
    expect(checkUrl("https://example.com/recipes/1").ok).toBe(true);
  });
});

// The other half of the SSRF hole, and the easier one to walk through: a hostname with
// nothing wrong in the string and an A record pointing at the metadata address. checkUrl
// reads strings, so it cannot see this at all; the resolver is injected here the same way
// deps.fetch is, so these never touch DNS.
describe("fetchCapped, hosts that resolve into private space", () => {
  const resolvesTo = (...addrs: string[]) => async () => addrs;

  it("refuses a public-looking name whose A record is the metadata address", async () => {
    const { fn, seen } = stubFetch({ "http://evil.example/": () => html("<p>hi</p>") });
    await expect(
      fetchCapped(new URL("http://evil.example/"), {
        fetch: fn,
        resolve: resolvesTo("169.254.169.254"),
      }),
    ).rejects.toThrow("not a public web address");
    // The point is that it never connected, not merely that it threw afterwards.
    expect(seen).toEqual([]);
  });

  it("refuses a name that resolves to loopback", async () => {
    const { fn } = stubFetch({ "http://evil.example/": () => html("<p>hi</p>") });
    await expect(
      fetchCapped(new URL("http://evil.example/"), { fetch: fn, resolve: resolvesTo("127.0.0.1") }),
    ).rejects.toThrow("not a public web address");
  });

  it("refuses a name that resolves to private space over IPv6", async () => {
    const { fn } = stubFetch({ "http://evil.example/": () => html("<p>hi</p>") });
    await expect(
      fetchCapped(new URL("http://evil.example/"), { fetch: fn, resolve: resolvesTo("fd00::1") }),
    ).rejects.toThrow("not a public web address");
  });

  it("refuses when ONE of several records is private, not only when all are", async () => {
    // A split answer is the obvious way to smuggle one past a check that looks at the first
    // record and stops.
    const { fn } = stubFetch({ "http://evil.example/": () => html("<p>hi</p>") });
    await expect(
      fetchCapped(new URL("http://evil.example/"), {
        fetch: fn,
        resolve: resolvesTo("93.184.216.34", "169.254.169.254"),
      }),
    ).rejects.toThrow("not a public web address");
  });

  it("re-resolves on a REDIRECT, not only on the first hop", async () => {
    // The classic bypass: a genuinely public page answers 302 to a host that resolves
    // somewhere private.
    const { fn } = stubFetch({
      "http://good.example/": () =>
        new Response(null, { status: 302, headers: { location: "http://evil.example/" } }),
      "http://evil.example/": () => html("<p>secrets</p>"),
    });
    const resolve = async (h: string) => (h === "evil.example" ? ["169.254.169.254"] : ["93.184.216.34"]);
    await expect(
      fetchCapped(new URL("http://good.example/"), { fetch: fn, resolve }),
    ).rejects.toThrow("not a public web address");
  });

  it("allows a name that resolves to a public address", async () => {
    const { fn } = stubFetch({ "http://good.example/": () => html("<p>a recipe</p>") });
    await expect(
      fetchCapped(new URL("http://good.example/"), { fetch: fn, resolve: resolvesTo("93.184.216.34") }),
    ).resolves.toContain("a recipe");
  });

  it("still works on a runtime with no resolver, rather than refusing everything", async () => {
    // `Deno.resolveDns` needs a net permission and is not in every edge runtime. Degrading to
    // the literal checks leaves that runtime exactly where it was before this guard existed;
    // failing closed would take the feature away from it entirely.
    const { fn } = stubFetch({ "http://good.example/": () => html("<p>a recipe</p>") });
    await expect(
      fetchCapped(new URL("http://good.example/"), { fetch: fn, resolve: null }),
    ).resolves.toContain("a recipe");
  });

  it("blocks a spelled-out private address even with no resolver", async () => {
    const { fn } = stubFetch({ "http://169.254.169.254/": () => html("<p>secrets</p>") });
    await expect(
      fetchCapped(new URL("http://169.254.169.254/"), { fetch: fn, resolve: null }),
    ).rejects.toThrow("not a public web address");
  });

  it("does not try to resolve an address literal", async () => {
    // Passing a literal to a resolver is an error on most runtimes, and the literal checks
    // have already judged it.
    let called = false;
    const { fn } = stubFetch({ "http://93.184.216.34/": () => html("<p>a recipe</p>") });
    await fetchCapped(new URL("http://93.184.216.34/"), {
      fetch: fn,
      resolve: async () => {
        called = true;
        return [];
      },
    });
    expect(called).toBe(false);
  });
});
