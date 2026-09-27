import { test, expect } from "vitest";
import { cellId, parseCellId, resolveDrop } from "./planDrop";
import type { MealPlanItem } from "./api/types";

const item = (over: Partial<MealPlanItem> = {}): MealPlanItem => ({
  id: "i1", plan_id: "p1", recipe_id: "r1",
  day: "2026-09-28", meal_slot: "dinner", position: 0, servings: null, leftover_of: null,
  ...over,
});

test("a cell id survives a round trip", () => {
  expect(parseCellId(cellId("2026-09-28", "dinner"))).toEqual({
    day: "2026-09-28", mealSlot: "dinner",
  });
});

test("anything that is not a cell id parses to nothing", () => {
  expect(parseCellId("i1")).toBeNull();
  expect(parseCellId("cell:")).toBeNull();
  expect(parseCellId("cell:2026-09-28")).toBeNull();
  // A third segment means the id is not the shape this built, so refuse it rather than
  // guessing which parts were meant.
  expect(parseCellId("cell:2026-09-28:dinner:extra")).toBeNull();
});

test("dropping a meal on another cell moves it there", () => {
  const move = resolveDrop("i1", cellId("2026-09-29", "lunch"), [item()]);
  expect(move).toEqual({ itemId: "i1", day: "2026-09-29", mealSlot: "lunch" });
});

test("an unscheduled meal dropped on a cell gets both a day and a slot", () => {
  const move = resolveDrop("i1", cellId("2026-09-29", "breakfast"), [
    item({ day: null, meal_slot: null }),
  ]);
  expect(move).toEqual({ itemId: "i1", day: "2026-09-29", mealSlot: "breakfast" });
});

// The commonest gesture of all is a drag that ends where it began: a mis-grab, or a changed
// mind. It must cost nothing.
test("dropping a meal back where it started does nothing", () => {
  expect(resolveDrop("i1", cellId("2026-09-28", "dinner"), [item()])).toBeNull();
});

test("the same slot on a different day is still a move", () => {
  const move = resolveDrop("i1", cellId("2026-09-30", "dinner"), [item()]);
  expect(move).toEqual({ itemId: "i1", day: "2026-09-30", mealSlot: "dinner" });
});

test("a drag released over nothing does nothing", () => {
  expect(resolveDrop("i1", null, [item()])).toBeNull();
});

test("a drop on something that is not a cell does nothing", () => {
  expect(resolveDrop("i1", "some-other-droppable", [item()])).toBeNull();
});

test("a drag of an item that is no longer in the list does nothing", () => {
  expect(resolveDrop("gone", cellId("2026-09-29", "lunch"), [item()])).toBeNull();
});

// Leftovers are ordinary items as far as moving goes; only their shopping behaviour differs.
test("a leftover can be moved like anything else", () => {
  const move = resolveDrop("i2", cellId("2026-09-29", "lunch"), [
    item({ id: "i2", leftover_of: "i1" }),
  ]);
  expect(move).toEqual({ itemId: "i2", day: "2026-09-29", mealSlot: "lunch" });
});
