import { addDays, dayLabel } from "./dates";

test("adds days without a UTC round trip", () => {
  expect(addDays("2026-09-21", 1)).toBe("2026-09-22");
  expect(addDays("2026-09-21", 0)).toBe("2026-09-21");
  expect(addDays("2026-09-21", 7)).toBe("2026-09-28");
});
test("crosses a month boundary", () => {
  expect(addDays("2026-09-30", 1)).toBe("2026-10-01");
  expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
});
test("crosses a leap day", () => {
  expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
  expect(addDays("2028-02-28", 2)).toBe("2028-03-01");
});
test("survives a spring-forward DST date", () => {
  // US DST starts 2026-03-08; noon anchoring keeps the date arithmetic whole
  expect(addDays("2026-03-07", 1)).toBe("2026-03-08");
  expect(addDays("2026-03-08", 1)).toBe("2026-03-09");
});
test("labels a day for the grid header", () => {
  expect(dayLabel("2026-09-21")).toMatch(/^\w{3,} 21$/);
});
