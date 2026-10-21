import { describe, it, expect } from "vitest";
import { activeStaffCount, kitchenThroughput } from "./kitchenNumbers";

// What this file pins: the console's kitchen figures, which have to mean the same thing as
// 0063's in-app ones, since a moderator and a group's own owner looking at the same kitchen
// must not be told two different stories. index.ts itself cannot be imported (it is Deno), so
// this is the only place the arithmetic can be checked at all.
//
// Every fixture gives its versions an id, because that is the only path from an approval to a
// dish: kitchen.approvals is keyed by version_id.

describe("kitchenThroughput", () => {
  it("counts a dish with no version as started and nothing else", () => {
    const result = kitchenThroughput([{ id: "d1" }], [], []);
    expect(result.started).toBe(1);
    expect(result.landed).toBe(0);
    expect(result.medianDays).toBeNull();
    expect(result.slowOverAMonth).toBe(0);
  });

  it("a dish is landed when any of its versions is approved", () => {
    const result = kitchenThroughput(
      [{ id: "d1" }],
      [
        { id: "v1", dish_id: "d1", created_at: "2026-01-01T00:00:00Z" },
        { id: "v2", dish_id: "d1", created_at: "2026-01-05T00:00:00Z" },
      ],
      [{ version_id: "v2", approved_at: "2026-01-06T00:00:00Z" }],
    );
    expect(result.landed).toBe(1);
  });

  it("the median runs from the first version to the first approval", () => {
    const result = kitchenThroughput(
      [{ id: "d1" }, { id: "d2" }],
      [
        { id: "v1", dish_id: "d1", created_at: "2026-01-01T00:00:00Z" },
        { id: "v2", dish_id: "d2", created_at: "2026-01-01T00:00:00Z" },
      ],
      [
        { version_id: "v1", approved_at: "2026-01-03T00:00:00Z" },
        { version_id: "v2", approved_at: "2026-01-09T00:00:00Z" },
      ],
    );
    // Two and eight days, so the mean of the two middle values, which is what
    // percentile_cont(0.5) does for an even count.
    expect(result.medianDays).toBe(5);
  });

  it("the median of one landed dish is its own interval", () => {
    const result = kitchenThroughput(
      [{ id: "d1" }],
      [{ id: "v1", dish_id: "d1", created_at: "2026-01-01T00:00:00Z" }],
      [{ version_id: "v1", approved_at: "2026-01-05T00:00:00Z" }],
    );
    expect(result.medianDays).toBe(4);
  });

  it("the median is null when nothing has landed", () => {
    const result = kitchenThroughput(
      [{ id: "d1" }],
      [{ id: "v1", dish_id: "d1", created_at: "2026-01-01T00:00:00Z" }],
      [],
    );
    expect(result.medianDays).toBeNull();
  });

  it("a dish revised and re-approved counts its first approval", () => {
    const result = kitchenThroughput(
      [{ id: "d1" }],
      [
        { id: "v1", dish_id: "d1", created_at: "2026-01-01T00:00:00Z" },
        { id: "v2", dish_id: "d1", created_at: "2026-01-10T00:00:00Z" },
      ],
      [
        // Deliberately out of order, because the rows arrive unordered and "first" has to mean
        // earliest rather than first in the array.
        { version_id: "v2", approved_at: "2026-01-11T00:00:00Z" },
        { version_id: "v1", approved_at: "2026-01-03T00:00:00Z" },
      ],
    );
    expect(result.medianDays).toBe(2);
    expect(result.landed).toBe(1);
  });

  it("takes the earliest version even when the rows arrive out of order", () => {
    const result = kitchenThroughput(
      [{ id: "d1" }],
      [
        { id: "v2", dish_id: "d1", created_at: "2026-01-10T00:00:00Z" },
        { id: "v1", dish_id: "d1", created_at: "2026-01-01T00:00:00Z" },
      ],
      [{ version_id: "v2", approved_at: "2026-01-11T00:00:00Z" }],
    );
    expect(result.medianDays).toBe(10);
  });

  it("counts a dish with no approval and an old first version as slow", () => {
    const result = kitchenThroughput(
      [{ id: "d1" }],
      [{ id: "v1", dish_id: "d1", created_at: "2026-01-01T00:00:00Z" }],
      [],
      new Date("2026-03-01T00:00:00Z"),
    );
    expect(result.slowOverAMonth).toBe(1);
  });

  it("does not count a landed dish as slow, however old", () => {
    const result = kitchenThroughput(
      [{ id: "d1" }],
      [{ id: "v1", dish_id: "d1", created_at: "2026-01-01T00:00:00Z" }],
      [{ version_id: "v1", approved_at: "2026-01-02T00:00:00Z" }],
      new Date("2026-06-01T00:00:00Z"),
    );
    expect(result.slowOverAMonth).toBe(0);
  });

  it("an empty kitchen is all zeroes and a null median", () => {
    expect(kitchenThroughput([], [], [])).toEqual({
      started: 0,
      landed: 0,
      medianDays: null,
      slowOverAMonth: 0,
    });
  });
});

describe("activeStaffCount", () => {
  it("counts distinct staff and not rows", () => {
    // One person, two days, three surfaces: one person.
    expect(
      activeStaffCount([{ user_id: "u1" }, { user_id: "u1" }, { user_id: "u1" }]),
    ).toBe(1);
  });

  it("counts two people as two", () => {
    expect(activeStaffCount([{ user_id: "u1" }, { user_id: "u2" }, { user_id: "u1" }])).toBe(2);
  });

  it("an empty week is nobody", () => {
    expect(activeStaffCount([])).toBe(0);
  });
});
