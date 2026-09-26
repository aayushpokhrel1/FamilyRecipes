import { describe, it, expect, vi } from "vitest";
import { callModelWithRetry } from "./retry";

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
