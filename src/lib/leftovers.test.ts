import { suggestedServings } from "./leftovers";

test("one leftover slot doubles the pot", () => {
  expect(suggestedServings(2, 1)).toBe(4);
});
test("two leftover slots triple it", () => {
  expect(suggestedServings(2, 2)).toBe(6);
});
test("no leftovers means no suggestion", () => {
  expect(suggestedServings(2, 0)).toBeNull();
});
test("no base to scale from means no suggestion, never a guess", () => {
  expect(suggestedServings(null, 1)).toBeNull();
  expect(suggestedServings(0, 1)).toBeNull();
});
