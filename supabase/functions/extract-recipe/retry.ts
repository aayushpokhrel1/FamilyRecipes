// Pure retry helper for the model call. No Deno or DOM specifics so it runs unchanged
// under vitest (Node) and the Deno edge runtime, the same arrangement as jsonld.ts.
//
// A hosted model answers 503 UNAVAILABLE when it is simply busy, and 429 when it is rate
// limited. Both are the provider saying "not now" rather than "never", and both were
// reaching the cook as a dead end in the middle of adding a recipe. One or two short waits
// turns almost all of them into a success.
//
// Only statuses that can fix themselves are retried. A 400 or a 401 is our bug or our key
// and will fail identically however many times it is sent, so retrying those would only
// make the wait longer before the same error arrives.
export const RETRY_STATUSES = new Set([429, 500, 502, 503, 504]);
export const BACKOFF_MS = [700, 1800];

// A provider that says "retry in 27 seconds" is not busy for a moment, it is done with us for
// this minute (a real Gemini free-tier 429 on 2026-09-30 asked for exactly that). Waiting is
// then the wrong move twice over: the cook sits watching a spinner, and the retries burn two
// more requests against the same exhausted quota and fail anyway. So a hint LONGER than this
// abandons the retries immediately and hands the response back, which is what lets the caller
// fall back to another provider instead.
export const MAX_HONOURED_WAIT_MS = 5000;

// Retry-After is seconds or an HTTP date; Google puts a `retryDelay: "27s"` in the body
// instead. Returns null when the provider gave no usable hint.
export function retryHintMs(res: { headers?: { get(name: string): string | null } }, body: string): number | null {
  const header = res.headers?.get("retry-after");
  if (header) {
    const secs = Number(header);
    if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
    const when = Date.parse(header);
    if (!Number.isNaN(when)) return Math.max(0, when - Date.now());
  }
  const m = /"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/.exec(body);
  return m ? Math.round(Number(m[1]) * 1000) : null;
}

export async function callModelWithRetry(
  url: string,
  headers: Record<string, string>,
  body: string,
  deps: {
    fetch?: (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<Response>;
    sleep?: (ms: number) => Promise<void>;
    backoff?: number[];
  } = {},
): Promise<Response> {
  const doFetch = deps.fetch ?? ((u, i) => fetch(u, i));
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const backoff = deps.backoff ?? BACKOFF_MS;

  let res = await doFetch(url, { method: "POST", headers, body });
  for (const wait of backoff) {
    if (!RETRY_STATUSES.has(res.status)) return res;
    // Read the hint from a CLONE: the body can only be consumed once, and the caller still
    // needs it to build its error message.
    let hint: number | null = null;
    try {
      hint = retryHintMs(res, await res.clone().text());
    } catch {
      // A body that cannot be read is not a reason to stop retrying.
    }
    if (hint !== null && hint > MAX_HONOURED_WAIT_MS) return res;
    await sleep(hint !== null ? Math.max(hint, wait) : wait);
    res = await doFetch(url, { method: "POST", headers, body });
  }
  return res;
}
