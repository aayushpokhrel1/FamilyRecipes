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

  // IPv4 literals in the ranges that are not routable on the public internet. 169.254.0.0/16
  // is the one that matters most: it contains 169.254.169.254, the cloud metadata address
  // that hands out credentials to anything that can reach it.
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (a === 127) return { ok: false, reason: "That link is not a public web address." }; // 127.0.0.0/8 loopback
    if (a === 10) return { ok: false, reason: "That link is not a public web address." }; // 10.0.0.0/8 private
    if (a === 172 && b >= 16 && b <= 31) return { ok: false, reason: "That link is not a public web address." }; // 172.16.0.0/12 private
    if (a === 192 && b === 168) return { ok: false, reason: "That link is not a public web address." }; // 192.168.0.0/16 private
    if (a === 169 && b === 254) return { ok: false, reason: "That link is not a public web address." }; // 169.254.0.0/16 link local, includes the metadata address
    if (a === 0) return { ok: false, reason: "That link is not a public web address." }; // 0.0.0.0/8 "this network"
  }

  // IPv6 literals. `::1` is loopback, `fc00::/7` (so anything starting fc or fd) is unique
  // local, and `fe80::/10` (so anything starting fe80) is link local. A prefix test is enough
  // here: these are the ranges that reach the machine or its own network.
  if (host.includes(":")) {
    if (host === "::1") return { ok: false, reason: "That link is not a public web address." };
    if (host.startsWith("fc") || host.startsWith("fd")) {
      return { ok: false, reason: "That link is not a public web address." };
    }
    if (host.startsWith("fe80")) return { ok: false, reason: "That link is not a public web address." };
  }

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
export async function fetchCapped(url: URL, deps: { fetch?: typeof fetch } = {}): Promise<string> {
  const doFetch = deps.fetch ?? ((u: string | URL, i?: RequestInit) => fetch(u, i));

  let current = url;
  for (let hop = 0; ; hop += 1) {
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
