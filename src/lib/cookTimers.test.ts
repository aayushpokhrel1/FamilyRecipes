import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as timers from "./cookTimers";

const seed = { recipeId: "r1", recipeTitle: "Dal", stepNumber: 2, label: "20 minutes", matchIndex: 11 };

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  timers.resetForTests();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("cookTimers", () => {
  it("counts down from an absolute end time", () => {
    const t = timers.start({ ...seed, seconds: 60 });
    expect(t.endsAt).toBe(Date.now() + 60_000);
    expect(t.ringing).toBe(false);
    expect(timers.list()).toHaveLength(1);
  });

  it("rings a timer whose end time has passed", () => {
    const ringing: string[] = [];
    timers.onRing((t) => ringing.push(t.id));
    const t = timers.start({ ...seed, seconds: 60 });
    vi.advanceTimersByTime(61_000);
    expect(timers.list().find((x) => x.id === t.id)?.ringing).toBe(true);
    expect(ringing).toEqual([t.id]);
  });

  it("rings only once per timer", () => {
    const ringing: string[] = [];
    timers.onRing((t) => ringing.push(t.id));
    timers.start({ ...seed, seconds: 10 });
    vi.advanceTimersByTime(60_000);
    expect(ringing).toHaveLength(1);
  });

  // The hidden-tab and sleeping-laptop case. A throttled tab wakes to find several
  // timers already due and must ring all of them.
  it("rings everything already due after a jump forward", () => {
    const ringing: string[] = [];
    timers.onRing((t) => ringing.push(t.id));
    timers.start({ ...seed, seconds: 60 });
    timers.start({ ...seed, matchIndex: 40, seconds: 120 });
    timers.start({ ...seed, matchIndex: 70, seconds: 9000 });
    vi.advanceTimersByTime(300_000);
    expect(ringing).toHaveLength(2);
    expect(timers.list().filter((t) => t.ringing)).toHaveLength(2);
  });

  // REVIEW FOCUS 3. An NTP correction moves the clock backwards. A timer must not ring
  // early, and must not report more time remaining than it was started with.
  it("does not ring early when the system clock moves backwards", () => {
    const ringing: string[] = [];
    timers.onRing((t) => ringing.push(t.id));
    const t = timers.start({ ...seed, seconds: 600 });
    vi.setSystemTime(Date.now() - 3_600_000);
    vi.advanceTimersByTime(2000);
    expect(ringing).toEqual([]);
    expect(t.endsAt).toBeGreaterThan(Date.now());
  });

  // REVIEW FOCUS 2. "fry 5 minutes, rest 5 minutes" is the same label at the same step.
  it("keeps two identical labels in one step as separate timers", () => {
    const a = timers.start({ ...seed, label: "5 minutes", matchIndex: 8, seconds: 300 });
    const b = timers.start({ ...seed, label: "5 minutes", matchIndex: 34, seconds: 300 });
    expect(a.id).not.toBe(b.id);
    expect(timers.list()).toHaveLength(2);
    expect(timers.findRunning("r1", 2, 8)?.id).toBe(a.id);
    expect(timers.findRunning("r1", 2, 34)?.id).toBe(b.id);
    expect(timers.findRunning("r1", 2, 99)).toBeUndefined();
  });

  it("cancels a running timer and dismisses a ringing one", () => {
    const a = timers.start({ ...seed, seconds: 600 });
    timers.cancel(a.id);
    expect(timers.list()).toHaveLength(0);

    const b = timers.start({ ...seed, seconds: 10 });
    vi.advanceTimersByTime(20_000);
    expect(timers.list()[0].ringing).toBe(true);
    timers.dismiss(b.id);
    expect(timers.list()).toHaveLength(0);
  });

  it("notifies subscribers on every change and stops after unsubscribe", () => {
    const fn = vi.fn();
    const off = timers.subscribe(fn);
    const t = timers.start({ ...seed, seconds: 600 });
    expect(fn).toHaveBeenCalled();
    off();
    const before = fn.mock.calls.length;
    timers.cancel(t.id);
    expect(fn.mock.calls.length).toBe(before);
  });

  it("runs no interval while there are no timers", () => {
    expect(vi.getTimerCount()).toBe(0);
    const t = timers.start({ ...seed, seconds: 600 });
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    timers.cancel(t.id);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("restores a timer across a reload", () => {
    timers.start({ ...seed, seconds: 600 });
    timers.resetForTests();
    expect(timers.list()).toHaveLength(1);
    expect(timers.list()[0].label).toBe("20 minutes");
  });

  it("drops a timer stale by more than an hour rather than ringing it", () => {
    const stale = [{ ...seed, id: "x", endsAt: Date.now() - 3_700_000, ringing: false }];
    localStorage.setItem("cookTimers", JSON.stringify(stale));
    timers.resetForTests();
    expect(timers.list()).toEqual([]);
  });

  it("restores a recently expired timer as ringing, because that one was missed", () => {
    const recent = [{ ...seed, id: "x", endsAt: Date.now() - 60_000, ringing: false }];
    localStorage.setItem("cookTimers", JSON.stringify(recent));
    timers.resetForTests();
    expect(timers.list()).toHaveLength(1);
    expect(timers.list()[0].ringing).toBe(true);
  });

  // REVIEW FOCUS 5. Valid JSON of the wrong shape, from an older version of this feature.
  it("starts empty on corrupt or wrong-shaped stored data", () => {
    for (const bad of [
      "not json at all",
      '{"not":"an array"}',
      '[{"id":"x"}]',
      '[{"id":"x","endsAt":"soon","recipeId":"r","stepNumber":1,"label":"l"}]',
      '[null]',
      '[]',
    ]) {
      localStorage.setItem("cookTimers", bad);
      timers.resetForTests();
      expect(timers.list()).toEqual([]);
    }
  });

  it("works with no storage at all", () => {
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(() => timers.start({ ...seed, seconds: 600 })).not.toThrow();
    expect(timers.list()).toHaveLength(1);
    spy.mockRestore();
  });
});
