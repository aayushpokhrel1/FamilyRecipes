import { test, expect } from "vitest";
import { pickDeletable } from "./cleanup-demoted-photos.mjs";

const row = (recipe_id, id, is_cover) => ({ id, recipe_id, is_cover, storage_path: `${recipe_id}/${id}` });

// The whole point of the sweep: a demoted row whose recipe still has a cover is invisible and
// safe to remove.
test("a demoted row is removed when its recipe still has a cover", () => {
  const rows = [row("r1", "new", true), row("r1", "old", false)];
  expect(pickDeletable(rows).map((r) => r.id)).toEqual(["old"]);
});

// The dangerous case, and the reason this is a tested function rather than one clause of a
// query: the readers order by is_cover desc and take the FIRST row, so a recipe with no cover
// is displaying its non-cover photo. Deleting that destroys a picture someone can see.
test("a recipe whose only photo is non-cover is left completely alone", () => {
  const rows = [row("r2", "lonely", false)];
  expect(pickDeletable(rows)).toEqual([]);
});

test("covers are never deletable", () => {
  expect(pickDeletable([row("r3", "c", true)])).toEqual([]);
});

// One recipe's state must not decide another's.
test("recipes are judged independently", () => {
  const rows = [
    row("r1", "new", true), row("r1", "old", false),
    row("r2", "lonely", false),
    row("r3", "only-cover", true),
  ];
  expect(pickDeletable(rows).map((r) => r.id)).toEqual(["old"]);
});

test("several leftovers on one recipe all go", () => {
  const rows = [row("r1", "new", true), row("r1", "old1", false), row("r1", "old2", false)];
  expect(pickDeletable(rows).map((r) => r.id)).toEqual(["old1", "old2"]);
});

test("no photos at all is not an error", () => {
  expect(pickDeletable([])).toEqual([]);
});
