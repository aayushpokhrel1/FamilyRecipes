// The session cookie, and above all the CHUNKING, which is the part that works against a small
// dev user and fails against a real one.
//
// A browser refuses a cookie over about 4096 bytes silently: the write does not happen and
// nothing is raised. So a single-cookie implementation passes every test written against a
// short value and then presents in production as a random sign-out. These tests use values
// either side of the limit on purpose.
import { beforeEach, describe, expect, it } from "vitest";
import { cookieDomain, cookieStorage } from "./sessionCookie";

// jsdom implements document.cookie as a real cookie jar for set and get, but it does NOT
// implement Max-Age expiry on write-then-read within a tick, so erase() leaves the name behind
// with an empty value rather than removing it. That is faithful enough for what is asserted
// here (reads must not find a value), and the one thing it cannot test is the real browser's
// handling of Domain, which is why the hop is also walked in a browser.
function clearJar() {
  for (const part of document.cookie.split(";")) {
    const name = part.split("=")[0]?.trim();
    if (name) document.cookie = `${name}=; Max-Age=0; Path=/`;
  }
}

const KEY = "sb-test-auth-token";

beforeEach(() => {
  clearJar();
});

describe("a value that fits in one cookie", () => {
  it("round-trips", () => {
    cookieStorage.setItem(KEY, '{"access_token":"short"}');
    expect(cookieStorage.getItem(KEY)).toBe('{"access_token":"short"}');
  });

  it("survives the characters that would terminate a cookie early", () => {
    // A raw ; or , ends the cookie, so an unencoded JSON session truncates silently and comes
    // back as invalid JSON. This is why setItem encodes.
    const value = '{"a":"x;y,z","b":"p=q"}';
    cookieStorage.setItem(KEY, value);
    expect(cookieStorage.getItem(KEY)).toBe(value);
  });

  it("reads back null when nothing was ever written", () => {
    expect(cookieStorage.getItem("sb-never-written")).toBeNull();
  });
});

describe("a value too large for one cookie", () => {
  // Comfortably over the 3180 chunk size and over the browser's own ~4096 limit, which is the
  // size a real session reaches once it carries a user object.
  const big = JSON.stringify({ token: "q".repeat(9000) });

  it("round-trips through chunks", () => {
    cookieStorage.setItem(KEY, big);
    expect(cookieStorage.getItem(KEY)).toBe(big);
  });

  it("writes no cookie that exceeds the browser's limit", () => {
    cookieStorage.setItem(KEY, big);
    for (const part of document.cookie.split(";")) {
      // Name plus value. The real limit counts attributes too, which is why the chunk size
      // leaves room rather than sitting at 4096.
      expect(part.trim().length).toBeLessThan(4096);
    }
  });

  it("actually splits rather than writing one oversized cookie", () => {
    cookieStorage.setItem(KEY, big);
    const names = document.cookie
      .split(";")
      .map((p) => p.split("=")[0]?.trim())
      .filter((n): n is string => !!n && n.startsWith(KEY));
    expect(names.length).toBeGreaterThan(1);
    expect(names).toContain(`${KEY}.0`);
  });
});

describe("changing shape, which is where a stale tail comes from", () => {
  it("leaves no chunk behind when a large session is replaced by a small one", () => {
    cookieStorage.setItem(KEY, JSON.stringify({ token: "q".repeat(9000) }));
    cookieStorage.setItem(KEY, '{"token":"small"}');
    // The danger is `KEY.2` surviving and a later read reassembling new chunks plus one stale
    // tail into a corrupt session. Reading back the exact small value is what proves it did not.
    expect(cookieStorage.getItem(KEY)).toBe('{"token":"small"}');
  });

  it("leaves no single value behind when a small session is replaced by a large one", () => {
    cookieStorage.setItem(KEY, '{"token":"small"}');
    const big = JSON.stringify({ token: "q".repeat(9000) });
    cookieStorage.setItem(KEY, big);
    // getItem prefers the plain key, so a surviving small value would shadow the chunks and
    // hand back the PREVIOUS session, which is worse than handing back nothing.
    expect(cookieStorage.getItem(KEY)).toBe(big);
  });
});

describe("removeItem", () => {
  it("clears a single value", () => {
    cookieStorage.setItem(KEY, '{"token":"small"}');
    cookieStorage.removeItem(KEY);
    expect(cookieStorage.getItem(KEY)).toBeNull();
  });

  it("clears every chunk, so a sign-out does not leave a usable session", () => {
    cookieStorage.setItem(KEY, JSON.stringify({ token: "q".repeat(9000) }));
    cookieStorage.removeItem(KEY);
    // The worst outcome this file could have: signing out and leaving the session behind.
    expect(cookieStorage.getItem(KEY)).toBeNull();
  });
});

// THE DOMAIN, which is the one attribute that decides whether the cookie exists at all.
//
// Chrome refuses `Domain=localhost` and `Domain=.localhost` silently, so the dev answer has to
// be no Domain at all: measured in a browser on admin.localhost:5174 on 2026-10-26, after a
// day in which every dev sign-in was in memory only and the console answered "Not found" to a
// real moderator. jsdom's jar accepts what a browser rejects, so this test pins the DECISION
// rather than the browser's behaviour, which is the most a unit test can do here.
describe("the cookie's domain", () => {
  it("is the shared parent domain in production, which is what makes one sign-in cover three hosts", () => {
    expect(cookieDomain(false)).toBe(".enamelvault.com");
  });

  it("is absent in dev, because a browser refuses Domain=localhost", () => {
    expect(cookieDomain(true)).toBeNull();
  });
});
