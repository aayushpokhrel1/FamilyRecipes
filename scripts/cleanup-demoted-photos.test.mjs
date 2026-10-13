import { test, expect } from "vitest";
import { pickDeletable, pickForeign } from "./cleanup-demoted-photos.mjs";

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

// THE SWEEP RUNS AS THE SERVICE ROLE, so the storage policies that protect every other reader
// do not apply to it, and `storage_path` arrives from a column that nothing constrained until
// migration 0057. A cook could add a non-cover row to a recipe of their own that already has a
// cover, naming a stranger's file, and this script would have deleted it.
test("a row whose path is not inside its own recipe is never deleted", () => {
  const rows = [
    { id: "cover", recipe_id: "r1", is_cover: true, storage_path: "r1/cover" },
    { id: "theirs", recipe_id: "r1", is_cover: false, storage_path: "victim/photo" },
  ];
  expect(pickDeletable(rows)).toEqual([]);
  expect(pickForeign(rows).map((r) => r.id)).toEqual(["theirs"]);
});

test("a path that merely starts with the recipe id is still foreign", () => {
  // "r1x/photo" starts with "r1" and is a different folder. The separator is part of the rule,
  // which is the same reason isSiteHost uses an exact match rather than endsWith.
  const rows = [
    { id: "cover", recipe_id: "r1", is_cover: true, storage_path: "r1/cover" },
    { id: "sneaky", recipe_id: "r1", is_cover: false, storage_path: "r1x/photo" },
  ];
  expect(pickDeletable(rows)).toEqual([]);
  expect(pickForeign(rows).map((r) => r.id)).toEqual(["sneaky"]);
});

test("a missing or non-string path is foreign, not deletable", () => {
  const rows = [
    { id: "cover", recipe_id: "r1", is_cover: true, storage_path: "r1/cover" },
    { id: "null", recipe_id: "r1", is_cover: false, storage_path: null },
  ];
  expect(pickDeletable(rows)).toEqual([]);
  expect(pickForeign(rows).map((r) => r.id)).toEqual(["null"]);
});

test("an ordinary leftover is still deleted, so the guard has not disabled the sweep", () => {
  const rows = [
    { id: "new", recipe_id: "r1", is_cover: true, storage_path: "r1/new" },
    { id: "old", recipe_id: "r1", is_cover: false, storage_path: "r1/old" },
  ];
  expect(pickDeletable(rows).map((r) => r.id)).toEqual(["old"]);
  expect(pickForeign(rows)).toEqual([]);
});
