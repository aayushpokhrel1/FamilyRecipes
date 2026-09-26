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
    await sleep(wait);
    res = await doFetch(url, { method: "POST", headers, body });
  }
  return res;
}
