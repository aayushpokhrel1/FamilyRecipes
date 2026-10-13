// Input limits for the extract-recipe edge function. No Deno or DOM specifics so it runs
// unchanged under vitest (Node) and the Deno edge runtime, the same arrangement as retry.ts,
// jsonld.ts, htmlText.ts, errors.ts and fallback.ts.
//
// WHY THIS EXISTS: nothing used to bound what a caller could send. `payload` went straight
// into a model call, so one hostile request could cost an enormous number of input tokens,
// and url mode did `await (await fetch(payload)).text()` on ANY string, which fetched
// multi-gigabyte files and reached `http://127.0.0.1/...` and cloud metadata addresses that
// the caller cannot reach themselves. That is a server-side request forgery hole, not only a
// cost problem. Every rule below is a pure function so it can be unit tested here rather than
// discovered in production.

// A knob, not a law. These are CHARACTERS of the incoming payload string, not bytes, because
// that is what the caller sends and what the model is billed for.
//
// text: 100_000 characters is many times the longest real recipe. A long one with a story is
// a few thousand characters, so this only ever rejects a paste that is not a recipe at all.
// url: 2_000 characters is far longer than any real link, and a "url" of 100k characters is
// either a mistake or an attempt to make the function fetch something enormous.
// image and audio: 10_000_000 characters, because both arrive as base64 data URLs and base64
// is about 4 characters per 3 bytes. A photo from a phone is sent WITHOUT being shrunk first,
// so a 6MB photo is roughly 8 million characters of payload. A tighter cap would reject
// honest use, which is the failure mode that matters here: a cook with a normal phone photo
// being told their picture is too big.
export const MAX_PAYLOAD: Record<string, number> = {
  text: 100_000,
  url: 2_000,
  image: 10_000_000,
  audio: 10_000_000,
};

// The cook-facing wording, in the voice of errors.ts: it addresses a cook, not a developer,
// and always offers the next thing they can do. Returns null when the payload is acceptable,
// so the caller can write `const problem = payloadTooLarge(mode, payload); if (problem) ...`.
export function payloadTooLarge(mode: string, payload: string): string | null {
  // An unknown mode falls back to the text limit. A mode we do not recognise is not a reason
  // to accept an unbounded string, and text is the smallest cap, so the safe default is also
  // the strict one.
  const limit = MAX_PAYLOAD[mode] ?? MAX_PAYLOAD.text;
  if (payload.length <= limit) return null;
  if (mode === "image") {
    return "That picture is too large to read. Take the photo again at a smaller size, or type the recipe in by hand.";
  }
  if (mode === "audio") {
    return "That recording is too long to listen to in one go. Send a shorter clip, or type the recipe in by hand.";
  }
  if (mode === "url") {
    return "That link is too long to be a real web address. Check the link, or paste the recipe text instead.";
  }
  return "That text is too long to read in one go. Paste a single recipe, or type it in by hand.";
}

// `new URL` throws on anything that is not a URL, and a throw is not a value the caller can
// branch on, so this turns it into null. Kept separate from checkUrl so the try/catch does not
// sit in the middle of the rules.
function parseUrl(raw: string): URL | null {
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

/**
 * An IPv4-mapped IPv6 address, written back as the dotted quad it actually is, or null.
 *
 * THE URL PARSER DOES NOT HAND BACK WHAT WAS TYPED, and that is the whole reason this
 * function exists. `new URL("http://[::ffff:169.254.169.254]/").hostname` is
 * "[::ffff:a9fe:a9fe]": the dotted quad is rewritten into hex. Before the 2026-10-12 audit
 * the IPv4 branch below tested for dots and never matched this, while the IPv6 branch tested
 * three literal prefixes (`::1`, `fc`/`fd`, `fe80`) that a mapped address starts with none
 * of. So `http://[::ffff:169.254.169.254]/latest/meta-data/` went straight through a check
 * whose own comment said the metadata address was the one that mattered most.
 *
 * Both spellings are accepted because both reach the same host, and so is the uncompressed
 * `0:0:0:0:0:ffff:` form. Anything before the `ffff` group that is not zeros is a real
 * address that merely contains those four characters, so it is left alone.
 */
function mappedToV4(host: string): string | null {
  const m = /^(.*:)?ffff:([^:]+(?::[^:]+)?)$/i.exec(host);
  if (!m) return null;
  const prefix = m[1] ?? "";
  if (prefix && !/^(?:0{1,4}:|:)+$/.test(prefix)) return null;
  const tail = m[2];
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(tail)) return tail;
  const hex = /^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(tail);
  if (!hex) return null;
  const hi = parseInt(hex[1], 16);
  const lo = parseInt(hex[2], 16);
  return [hi >> 8, hi & 255, lo >> 8, lo & 255].join(".");
}

/**
 * Whether a host LITERAL names an address that is not routable on the public internet.
 *
 * Exported because it is the same judgement whether the address was typed by the cook or
 * came back from a DNS lookup, and a second copy of this list would be a second thing to
 * forget. `fetchCapped` reuses it on resolved addresses.
 *
 * A LITERAL is all this can judge. `evil.example` with an A record of 169.254.169.254 passes
 * every test here, because there is nothing in the string to fail. See `checkResolved`.
 */
export function privateLiteral(hostRaw: string): boolean {
  const host = hostRaw.toLowerCase().replace(/^\[/, "").replace(/\]$/, "").replace(/\.$/, "");

  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(mappedToV4(host) ?? host);
  if (v4) {
    const [a, b, c] = [Number(v4[1]), Number(v4[2]), Number(v4[3])];
    if (a === 0) return true; // 0.0.0.0/8 "this network", and 0.0.0.0 itself, which is local
    if (a === 10) return true; // private
    if (a === 127) return true; // loopback
    if (a === 169 && b === 254) return true; // link local, and it holds 169.254.169.254
    if (a === 172 && b >= 16 && b <= 31) return true; // private
    if (a === 192 && b === 168) return true; // private
    if (a === 192 && b === 0 && c === 0) return true; // 192.0.0.0/24 IETF protocol assignments
    if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 carrier-grade NAT
    if (a === 198 && (b === 18 || b === 19)) return true; // 198.18.0.0/15 benchmarking
    if (a >= 224) return true; // 224.0.0.0/4 multicast, 240.0.0.0/4 reserved, and broadcast
    return false;
  }

  if (host.includes(":")) {
    // `::` is the unspecified address. Connecting to it reaches the local machine, so it
    // belongs here next to `::1` and was missing: it starts with none of the three prefixes.
    if (host === "::" || host === "::1") return true;
    if (/^(?:0{1,4}:){7}0{0,3}1$/.test(host)) return true; // uncompressed loopback
    if (host.startsWith("fc") || host.startsWith("fd")) return true; // fc00::/7 unique local
    if (host.startsWith("fe80")) return true; // fe80::/10 link local
  }

  return false;
}

// A HOST check, so it cannot by itself stop a public URL that REDIRECTS to a private one.
// fetchCapped below closes that by running this same check on every hop it follows.
export function checkUrl(raw: string): { ok: true; url: URL } | { ok: false; reason: string } {
  // A string that is not a URL at all has no host to judge, and fetch would throw on it
  // anyway. Rejecting it here turns that into a sentence the cook can read.
  const url = parseUrl(raw);
  if (!url) return { ok: false, reason: "That does not look like a web address." };

  // Exactly http or https. This is what rejects `file:`, `data:` and `gopher:`, which are the
  // schemes that read the server's own disk or smuggle a payload past a host check.
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, reason: "That link is not a web page we can open." };
  }

  // URL keeps the brackets on an IPv6 literal, so `http://[::1]/` arrives as `[::1]`. Strip
  // them before testing, or the loopback check below never matches.
  // The trailing dot is stripped LAST and it is not cosmetic: `localhost.` is the
  // root-anchored form of `localhost` and resolves to exactly the same machine, but the URL
  // parser preserves that dot for a domain, so every endsWith and every equality below would
  // miss it. Verified in Node: `new URL("http://localhost./").hostname` is "localhost.",
  // while an IPv4 literal like `127.0.0.1.` is normalised for us. This is a known SSRF
  // bypass, so the tests pin all three of localhost., .internal. and
  // metadata.google.internal. by name.
  const host = url.hostname.toLowerCase()
    .replace(/^\[/, "").replace(/\]$/, "")
    .replace(/\.$/, "");

  // Names that resolve to the machine itself or to a private network. `localhost` and
  // anything under it, plus the `.local` (mDNS) and `.internal` (cloud) suffixes, are all
  // ways to name a host the caller cannot reach from outside.
  if (host === "localhost" || host.endsWith(".localhost")) {
    return { ok: false, reason: "That link is not a public web address." };
  }
  if (host.endsWith(".local") || host.endsWith(".internal")) {
    return { ok: false, reason: "That link is not a public web address." };
  }
  // The Google Cloud metadata host, named explicitly because it is the classic target of this
  // exact hole and it is worth being able to point at the line that stops it.
  if (host === "metadata.google.internal") {
    return { ok: false, reason: "That link is not a public web address." };
  }

  if (privateLiteral(host)) return { ok: false, reason: "That link is not a public web address." };

  return { ok: true, url };
}

// A knob, not a law. 2MB of HTML is far more than any recipe page's useful text, and
// htmlText.ts caps what it keeps at 12000 characters anyway, so this only bounds how much
// the function is willing to READ. It is what stops a link to a multi-gigabyte file from
// costing the function gigabytes of memory and bandwidth.
export const MAX_FETCH_BYTES = 2_000_000;

// How many redirects we are willing to follow by hand. Three is what a normal link shortener
// plus a canonical redirect needs, and every extra hop is another chance to be pointed at a
// private address, so the budget is deliberately small.
const MAX_REDIRECTS = 3;

/** Resolves a hostname to address literals. Injected, so the tests never touch DNS. */
export type Resolver = (host: string) => Promise<string[]>;

/**
 * The runtime's resolver, or null where there is not one.
 *
 * NULL IS NOT A FAILURE AND MUST NOT BECOME ONE. `Deno.resolveDns` needs a net permission
 * and is not present in every edge runtime, so this degrades to the literal checks rather
 * than refusing every link. The literal checks are what shipped before, so a runtime without
 * a resolver is no worse off than it was, and one with a resolver is better.
 */
const runtimeResolver: Resolver | null = (() => {
  const deno = (globalThis as { Deno?: { resolveDns?: unknown } }).Deno;
  if (!deno || typeof deno.resolveDns !== "function") return null;
  const resolveDns = deno.resolveDns as (h: string, t: string) => Promise<string[]>;
  return async (host: string) => {
    const out: string[] = [];
    for (const type of ["A", "AAAA"]) {
      // A host with no AAAA record is normal, not an error worth propagating.
      try {
        out.push(...(await resolveDns(host, type)));
      } catch {
        // no record of this type
      }
    }
    return out;
  };
})();

/**
 * Reject a host that RESOLVES into private space, as opposed to one that is spelled that way.
 *
 * This is the half of the SSRF guard that `checkUrl` structurally cannot do. `checkUrl` reads
 * a string, and `http://evil.example/` is a string with nothing wrong in it; the A record
 * pointing at 169.254.169.254 is somewhere else entirely. Before the 2026-10-12 audit that
 * was the whole bypass, and it needed no cleverness at all: register a domain, point it at
 * the metadata address.
 *
 * IT IS A MITIGATION, NOT A CURE, and the gap has a name. `fetch` resolves the host AGAIN
 * when it connects, so a DNS server that answers with a public address here and a private one
 * a moment later (DNS rebinding) still gets through. Closing that means connecting to the
 * address this function already resolved, which needs a client that accepts a pinned IP
 * (`Deno.createHttpClient`), and that is not available in every runtime either. The honest
 * state is: spelled-out addresses are blocked outright, a static private A record is blocked
 * here, and rebinding is not.
 */
async function assertResolvesPublic(url: URL, resolve: Resolver | null): Promise<void> {
  const host = url.hostname.toLowerCase().replace(/^\[/, "").replace(/\]$/, "").replace(/\.$/, "");
  if (privateLiteral(host)) throw new Error("That link is not a public web address.");
  if (!resolve) return;
  // An address literal has nothing to look up, and a resolver would reject it as a name.
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host) || host.includes(":")) return;

  let addresses: string[] = [];
  try {
    addresses = await resolve(host);
  } catch {
    // A name that will not resolve is a fetch that will fail on its own, with a better
    // message than this function could invent. Refusing here would turn every DNS hiccup
    // into "that link is not a public web address", which is a lie.
    return;
  }
  for (const address of addresses) {
    if (privateLiteral(address)) throw new Error("That link is not a public web address.");
  }
}

// Fetch a URL with the two guards a plain `fetch` does not have: every hop is re-checked, and
// the body is read with a ceiling.
//
// The redirects are followed MANUALLY (`redirect: "manual"`) so that each `Location` can be
// run through checkUrl before it is fetched. A public page that answers 302 to
// `http://169.254.169.254/` would otherwise walk straight past the host check on the original
// URL, which is the whole reason a host check alone is not enough.
//
// The URL passed in is NOT checked here: it takes a `URL`, so the caller is expected to have
// run checkUrl on it already (that is what turns a bad link into a sentence for the cook
// rather than an exception). What this function guarantees is that no REDIRECT can escape
// that check.
//
// `deps.fetch` is injected exactly as retry.ts injects it, so the tests never touch the
// network.
export async function fetchCapped(
  url: URL,
  deps: { fetch?: typeof fetch; resolve?: Resolver | null } = {},
): Promise<string> {
  const doFetch = deps.fetch ?? ((u: string | URL, i?: RequestInit) => fetch(u, i));
  const resolve = deps.resolve !== undefined ? deps.resolve : runtimeResolver;

  let current = url;
  for (let hop = 0; ; hop += 1) {
    // Hop 0 included: the caller ran checkUrl, but that judges the STRING, and a name is
    // only an address after it is resolved.
    await assertResolvesPublic(current, resolve);
    const res = await doFetch(current, { redirect: "manual" });

    // A redirect is a new URL, so it is a new decision. Resolve a relative Location against
    // the current URL, because `Location: /recipe/1` is the common case and `new URL` would
    // throw on it.
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location) throw new Error("That link sent us somewhere we could not follow.");
      if (hop >= MAX_REDIRECTS) throw new Error("That link bounced us around too many times to follow.");
      const next = checkUrl(new URL(location, current).toString());
      if (!next.ok) throw new Error(next.reason);
      current = next.url;
      continue;
    }

    // Truncating beats failing here. A recipe's text sits near the top of the page, and
    // htmlText.ts already strips everything it does not need, so half a page is usually still
    // a usable extraction. A hard failure on a large page is always a dead end for the cook,
    // and the size of the page is not something they can do anything about.
    if (!res.body) {
      // No streaming body to read (a stubbed response, or a runtime that does not expose
      // one), so take the whole text and cut it. Same ceiling, same reasoning.
      const text = await res.text();
      return text.length > MAX_FETCH_BYTES ? text.slice(0, MAX_FETCH_BYTES) : text;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let out = "";
    let read = 0;
    while (read < MAX_FETCH_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      read += value.byteLength;
      // `stream: true` so a multi-byte character split across two chunks is not mangled into
      // a replacement character in the middle of an ingredient line.
      out += decoder.decode(value, { stream: true });
    }
    // Stop reading rather than draining the rest: the point of the cap is to not pay for the
    // bytes we are going to throw away.
    try {
      await reader.cancel();
    } catch {
      // A body that cannot be cancelled is already finished or already gone, and either way
      // there is nothing left to do about it.
    }
    out += decoder.decode();
    return out.length > MAX_FETCH_BYTES ? out.slice(0, MAX_FETCH_BYTES) : out;
  }
}
