import { describe, expect, it } from "vitest";
import { findDurations } from "./stepDuration";

describe("findDurations", () => {
  it("reads plain minutes, seconds and hours", () => {
    expect(findDurations("Simmer for 20 minutes.")[0]).toMatchObject({ label: "20 minutes", seconds: 1200 });
    expect(findDurations("Simmer for 20 mins.")[0]).toMatchObject({ seconds: 1200 });
    expect(findDurations("Simmer for 20 min.")[0]).toMatchObject({ seconds: 1200 });
    expect(findDurations("Rest 45 seconds.")[0]).toMatchObject({ seconds: 45 });
    expect(findDurations("Rest 45 secs.")[0]).toMatchObject({ seconds: 45 });
    expect(findDurations("Bake 1 hour.")[0]).toMatchObject({ seconds: 3600 });
    expect(findDurations("Bake 2 hours.")[0]).toMatchObject({ seconds: 7200 });
    expect(findDurations("Bake 1 hr.")[0]).toMatchObject({ seconds: 3600 });
  });

  it("reads a compound hour and minute duration as one timer", () => {
    const found = findDurations("Roast for 1 hour 30 minutes.");
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ label: "1 hour 30 minutes", seconds: 5400 });
  });

  it("reads a fractional hour", () => {
    expect(findDurations("Prove for 1 1/2 hours.")[0]).toMatchObject({ seconds: 5400 });
    expect(findDurations("Prove for 2 1/2 hours.")[0]).toMatchObject({ seconds: 9000 });
  });

  it("reads the worded singular", () => {
    expect(findDurations("Leave for an hour.")[0]).toMatchObject({ seconds: 3600 });
    expect(findDurations("Wait a minute.")[0]).toMatchObject({ seconds: 60 });
  });

  it("takes the longer end of a range, so it never rings early", () => {
    expect(findDurations("Fry for 10-12 minutes.")[0]).toMatchObject({ seconds: 720 });
    expect(findDurations("Fry for 10 to 12 minutes.")[0]).toMatchObject({ seconds: 720 });
    expect(findDurations("Fry for 1-2 hours.")[0]).toMatchObject({ seconds: 7200 });
  });

  it("returns every duration in reading order", () => {
    const found = findDurations("Fry for 5 minutes, then simmer for 20 minutes.");
    expect(found.map((d) => d.seconds)).toEqual([300, 1200]);
    expect(found[0].index).toBeLessThan(found[1].index);
  });

  // REVIEW FOCUS 1. Without a whole-word rule on the unit, "20 ml" parses as twenty
  // minutes and an ingredient quantity sitting in a step becomes a timer.
  it("never reads an ingredient quantity as a duration", () => {
    expect(findDurations("Add 20 ml of oil.")).toEqual([]);
    expect(findDurations("Add 500 mg of salt.")).toEqual([]);
    expect(findDurations("Add 3 eggs.")).toEqual([]);
    expect(findDurations("Add 200 g of flour.")).toEqual([]);
    expect(findDurations("Heat to 180 C.")).toEqual([]);
  });

  it("refuses to guess at a vague duration", () => {
    expect(findDurations("Leave overnight.")).toEqual([]);
    expect(findDurations("Cook until golden.")).toEqual([]);
    expect(findDurations("Cook until tender.")).toEqual([]);
    expect(findDurations("Wait a couple of minutes.")).toEqual([]);
    expect(findDurations("Wait a few minutes.")).toEqual([]);
    expect(findDurations("Leave for several hours.")).toEqual([]);
    expect(findDurations("Leave for half an hour.")).toEqual([]);
  });

  it("ignores an absurd duration rather than clamping it", () => {
    expect(findDurations("Cure for 48 hours.")).toEqual([]);
    expect(findDurations("Cure for 2000 minutes.")).toEqual([]);
  });

  it("returns nothing for a step with no duration", () => {
    expect(findDurations("Chop the onions finely.")).toEqual([]);
    expect(findDurations("")).toEqual([]);
  });
});
