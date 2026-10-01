import { describe, it, expect, vi } from "vitest";
import { callModelWithRetry, retryHintMs } from "./retry";

// No real waiting: the backoff is injected so the test does not sleep for seconds.
const nowait = { sleep: async () => {}, backoff: [1, 1] };

function responder(statuses: number[]) {
  const calls: number[] = [];
  let i = 0;
  const fetchMock = vi.fn(async () => {
    const status = statuses[Math.min(i, statuses.length - 1)];
    calls.push(status);
    i += 1;
    return new Response("body", { status });
  });
  return { fetchMock, calls };
}

describe("callModelWithRetry", () => {
  it("does not retry a success", async () => {
    const { fetchMock } = responder([200]);
    const res = await callModelWithRetry("u", {}, "b", { ...nowait, fetch: fetchMock });
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  // The real report: Gemini answered 503 "experiencing high demand" mid-recipe.
  it("retries a 503 and returns the eventual success", async () => {
    const { fetchMock } = responder([503, 200]);
    const res = await callModelWithRetry("u", {}, "b", { ...nowait, fetch: fetchMock });
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries a 429 too", async () => {
    const { fetchMock } = responder([429, 200]);
    const res = await callModelWithRetry("u", {}, "b", { ...nowait, fetch: fetchMock });
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  // A 400 is our own bad request and will fail identically forever, so retrying it only
  // delays the same error.
  it("does NOT retry a 400", async () => {
    const { fetchMock } = responder([400]);
    const res = await callModelWithRetry("u", {}, "b", { ...nowait, fetch: fetchMock });
    expect(res.status).toBe(400);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does NOT retry a 401", async () => {
    const { fetchMock } = responder([401]);
    await callModelWithRetry("u", {}, "b", { ...nowait, fetch: fetchMock });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("gives up after the backoff is exhausted and returns the last response", async () => {
    const { fetchMock } = responder([503]);
    const res = await callModelWithRetry("u", {}, "b", { ...nowait, fetch: fetchMock });
    expect(res.status).toBe(503);
    expect(fetchMock).toHaveBeenCalledTimes(3); // first try + two retries
  });

  it("waits between attempts, in increasing order", async () => {
    const waits: number[] = [];
    const { fetchMock } = responder([503]);
    await callModelWithRetry("u", {}, "b", {
      fetch: fetchMock,
      sleep: async (ms: number) => { waits.push(ms); },
      backoff: [700, 1800],
    });
    expect(waits).toEqual([700, 1800]);
  });
});

describe("retryHintMs", () => {
  const hdr = (v: string | null) => ({ headers: { get: () => v } });

  it("reads Retry-After in seconds", () => {
    expect(retryHintMs(hdr("27"), "")).toBe(27000);
  });

  it("reads an HTTP-date Retry-After", () => {
    const when = new Date(Date.now() + 10000).toUTCString();
    const got = retryHintMs(hdr(when), "") ?? 0;
    expect(got).toBeGreaterThan(7000);
    expect(got).toBeLessThanOrEqual(11000);
  });

  // Google does not send Retry-After, it puts the delay in the error body. This is the exact
  // shape of the 429 that prompted all of this.
  it("reads Google's retryDelay out of the body", () => {
    const body = JSON.stringify({ error: { details: [
      { "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "27.057530882s" },
    ] } });
    expect(retryHintMs(hdr(null), body)).toBe(27058);
  });

  it("returns null when there is no usable hint", () => {
    expect(retryHintMs(hdr(null), "just a message")).toBeNull();
  });
});

describe("callModelWithRetry and the provider's hint", () => {
  // THE POINT: a long hint means this provider is finished with us for now. Waiting 27s would
  // leave the cook watching a spinner and still fail, so it stops at once and hands the
  // response back for the caller to fall back on.
  it("abandons retries immediately when the hint is longer than we will wait", async () => {
    const fetchMock = vi.fn(async () => new Response(
      JSON.stringify({ error: { details: [{ retryDelay: "27s" }] } }), { status: 429 }));
    const slept: number[] = [];
    const res = await callModelWithRetry("u", {}, "b", {
      fetch: fetchMock, sleep: async (ms) => { slept.push(ms); }, backoff: [1, 1],
    });
    expect(res.status).toBe(429);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(slept).toEqual([]);
  });

  it("waits the hint when it is short, instead of the shorter default backoff", async () => {
    let n = 0;
    const fetchMock = vi.fn(async () => {
      n += 1;
      return n === 1
        ? new Response("{}", { status: 503, headers: { "retry-after": "2" } })
        : new Response("{}", { status: 200 });
    });
    const slept: number[] = [];
    const res = await callModelWithRetry("u", {}, "b", {
      fetch: fetchMock, sleep: async (ms) => { slept.push(ms); }, backoff: [1, 1],
    });
    expect(res.status).toBe(200);
    expect(slept).toEqual([2000]);
  });

  it("still uses the default backoff when no hint is given", async () => {
    const { fetchMock } = responder([503, 200]);
    const slept: number[] = [];
    await callModelWithRetry("u", {}, "b", {
      fetch: fetchMock, sleep: async (ms) => { slept.push(ms); }, backoff: [700, 1800],
    });
    expect(slept).toEqual([700]);
  });
});
