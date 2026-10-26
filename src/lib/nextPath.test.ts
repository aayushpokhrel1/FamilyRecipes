import { describe, expect, it } from "vitest";
import { safeNext, withNext, safeFrom, nextWithFrom, safeReturnUrl } from "./nextPath";
import { ADMIN_ORIGIN, FAMILY_ORIGIN, KITCHEN_ORIGIN } from "./hosts";

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

// THE CROSS-ORIGIN RETURN, which is the one place an absolute URL is allowed anywhere in this
// app. safeNext stays paths-only; this is the separate, narrower door, and these are the
// attacks it exists to refuse.
describe("safeReturnUrl", () => {
  it("accepts our own three origins", () => {
    expect(safeReturnUrl(`${ADMIN_ORIGIN}/`)).toBe(`${ADMIN_ORIGIN}/`);
    expect(safeReturnUrl(`${KITCHEN_ORIGIN}/orgs/new`)).toBe(`${KITCHEN_ORIGIN}/orgs/new`);
    expect(safeReturnUrl(`${FAMILY_ORIGIN}/settings`)).toBe(`${FAMILY_ORIGIN}/settings`);
  });

  it("keeps a query string, which an invite link needs", () => {
    expect(safeReturnUrl(`${ADMIN_ORIGIN}/?tab=trail`)).toBe(`${ADMIN_ORIGIN}/?tab=trail`);
  });

  it("refuses a foreign origin, which is the whole point", () => {
    expect(safeReturnUrl("https://evil.example/login")).toBeNull();
    expect(safeReturnUrl("http://evil.example/")).toBeNull();
  });

  // The bug class that ships: a hostname check written with startsWith or endsWith. An origin
  // comparison on a parsed URL cannot be fooled by either, and these pin that.
  // THESE ARE BUILT FROM THE SAME CONSTANTS THE ALLOWLIST USES, and that is the whole point.
  // The first version of these tests hardcoded "https://admin.enamelvault.com.evil.example",
  // while under Vitest the allowlist holds the LOCALHOST origins, so every one of them was
  // refused for the wrong reason and passed against any implementation at all. Replacing the
  // exact-origin check with a substring check left all of them green, which is how the hole
  // was found. Derive the attack from the real value or the test proves nothing.
  const adminHost = new URL(ADMIN_ORIGIN).host;

  it("refuses a lookalike that merely contains or extends one of ours", () => {
    expect(safeReturnUrl(`${ADMIN_ORIGIN}.evil.example/`)).toBeNull();
    expect(safeReturnUrl(`https://${adminHost}.evil.example/`)).toBeNull();
    expect(safeReturnUrl(`https://not${adminHost}/`)).toBeNull();
    expect(safeReturnUrl(`https://evil.example/${adminHost}`)).toBeNull();
    expect(safeReturnUrl(`https://evil.example/?x=${adminHost}`)).toBeNull();
  });

  // Credentials in a URL are how a lookalike gets past a careless reader: everything before
  // the @ is a username, so the real host here is evil.example. URL parsing gets this right
  // and a string comparison would not.
  it("refuses a userinfo trick", () => {
    expect(safeReturnUrl(`https://${adminHost}@evil.example/`)).toBeNull();
  });

  // The same host on the WRONG SCHEME. In production the allowlist is https, so an http URL
  // for the same host is a downgrade and must not be honoured.
  it("refuses our own host on another scheme or port", () => {
    const u = new URL(ADMIN_ORIGIN);
    const otherScheme = u.protocol === "https:" ? "http:" : "https:";
    expect(safeReturnUrl(`${otherScheme}//${u.host}/`)).toBeNull();
    expect(safeReturnUrl(`${u.protocol}//${u.hostname}:9999/`)).toBeNull();
  });

  it("refuses a non-http scheme on one of our own hosts", () => {
    expect(safeReturnUrl("javascript:alert(1)")).toBeNull();
    expect(safeReturnUrl("data:text/html,<script>alert(1)</script>")).toBeNull();
  });

  it("refuses a bare path, which belongs to safeNext", () => {
    // Two functions that both half-accept the same input is how one of them gets called in the
    // wrong place. This one takes absolute URLs only.
    expect(safeReturnUrl("/settings")).toBeNull();
    expect(safeReturnUrl("//evil.example")).toBeNull();
  });

  it("refuses nothing-at-all without throwing", () => {
    expect(safeReturnUrl(null)).toBeNull();
    expect(safeReturnUrl(undefined)).toBeNull();
    expect(safeReturnUrl("")).toBeNull();
    expect(safeReturnUrl("not a url")).toBeNull();
  });
});
