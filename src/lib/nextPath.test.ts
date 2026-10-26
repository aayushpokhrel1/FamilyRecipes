import { describe, expect, it } from "vitest";
import { safeNext, withNext, safeFrom, nextWithFrom } from "./nextPath";

describe("safeNext", () => {
  it("keeps a path inside this app", () => {
    expect(safeNext("/join/abc123")).toBe("/join/abc123");
    expect(safeNext("/recipes/1?scale=2")).toBe("/recipes/1?scale=2");
  });

  it("refuses anything a browser would read as another host", () => {
    // The parameter comes off a URL anyone can write, so these are the attack, not typos:
    // each one would turn our own sign-in page into a redirector to someone else's.
    for (const hostile of [
      "https://evil.example/login",
      "//evil.example",
      String.raw`/\evil.example`,
      "javascript:alert(1)",
      "evil.example",
      "/join\nLocation: https://evil.example",
    ]) {
      expect(safeNext(hostile)).toBeNull();
    }
  });

  it("treats nothing as nowhere in particular", () => {
    expect(safeNext(null)).toBeNull();
    expect(safeNext("")).toBeNull();
  });
});

describe("withNext", () => {
  it("encodes the destination so a path with its own query survives", () => {
    expect(withNext("/signin", "/join/abc")).toBe("/signin?next=%2Fjoin%2Fabc");
    expect(withNext("/signin", "/recipes/1?scale=2")).toBe(
      "/signin?next=%2Frecipes%2F1%3Fscale%3D2",
    );
  });

  it("leaves a bare auth URL alone when there is nowhere to go back to", () => {
    expect(withNext("/signin", null)).toBe("/signin");
    expect(withNext("/signin", "https://evil.example")).toBe("/signin");
  });
});

// safeFrom is the same kind of trust boundary as safeNext, narrower because the vocabulary is
// three words: anything else is a free-text value a stranger would be writing into the
// database, so it becomes null rather than being passed along.
test("safeFrom accepts the three marketing pages and nothing else", () => {
  expect(safeFrom("hub")).toBe("hub");
  expect(safeFrom("family")).toBe("family");
  expect(safeFrom("professional")).toBe("professional");

  expect(safeFrom("Family")).toBeNull();
  expect(safeFrom("hub ")).toBeNull();
  expect(safeFrom("'; drop table profiles; --")).toBeNull();
  expect(safeFrom("")).toBeNull();
  expect(safeFrom(null)).toBeNull();
  expect(safeFrom(undefined)).toBeNull();
});

test("nextWithFrom leaves the destination alone when there is no marketing source", () => {
  expect(nextWithFrom("/potluck", null)).toBe("/potluck");
  expect(nextWithFrom(null, null)).toBeNull();
  // A refused source must not invent a destination either, or a hostile ?from= would start
  // sending people to the home page instead of where they asked to go.
  expect(nextWithFrom("/potluck", "evil")).toBe("/potluck");
  expect(nextWithFrom(null, "evil")).toBeNull();
});

test("nextWithFrom folds the source into the destination so it survives signing in", () => {
  // With nowhere in particular to go the parameter still has to land somewhere, because
  // AppLayout reads it off the landing page's own URL.
  expect(nextWithFrom(null, "family")).toBe("/?from=family");
  expect(nextWithFrom("/potluck", "hub")).toBe("/potluck?from=hub");
});

test("nextWithFrom keeps a destination that already carries a query string valid", () => {
  // An invite link is the real case: it arrives as a next with its own parameters, and a
  // second "?" would make the whole thing unparseable.
  expect(nextWithFrom("/join/ABC?role=cook", "professional")).toBe(
    "/join/ABC?role=cook&from=professional",
  );
});

test("nextWithFrom refuses a hostile destination exactly as safeNext does", () => {
  // The open-redirect guard is not weakened by the fold: an off-site next is still refused,
  // and the source cannot smuggle one in.
  expect(nextWithFrom("https://evil.example/login", "family")).toBe("/?from=family");
  expect(nextWithFrom("//evil.example", "family")).toBe("/?from=family");
});
