import { expect, it } from "vitest";
import { sources } from "./sourceFiles";
import html from "../../index.html?raw";

// src/pages/Cookies.tsx tells people this app sets NO cookies and stores only four strictly
// necessary things, and that is the entire reason it shows no cookie banner. Under UK and EU
// law, the day a non-essential cookie or a tracking script appears, a consent banner becomes
// mandatory and that page becomes a false statement.
//
// Nobody is going to re-read a privacy page before adding a library. This test is what notices.
// If it fails, you have TWO jobs, not one: make the storage honest, and update Cookies.tsx.
//
// Adding a key that really is strictly necessary? Add it to KNOWN_KEYS and add a row to the
// table in Cookies.tsx. Adding anything else (analytics, ads, an embed, a session recorder)?
// That needs a consent banner first.

const KNOWN_KEYS = [
  "theme", // src/lib/theme.ts, and the pre-paint script in index.html
  "activeFamilyId", // src/context/FamilyContext.tsx
  "photo-url:", // src/lib/api/photos.ts, CACHE_PREFIX
];

// Third-party tags that each require consent before they may load.
const TRACKERS = [
  "googletagmanager",
  "google-analytics",
  "gtag(",
  "connect.facebook.net",
  "fbq(",
  "hotjar",
  "clarity.ms",
  "mixpanel",
  "segment.com",
  "fullstory",
  "doubleclick",
];

it("never writes a cookie, so no consent banner is required", () => {
  const offenders = sources
    .filter(({ text }) => /document\s*\.\s*cookie\s*=/.test(text))
    .map(({ path }) => path);
  expect(offenders).toEqual([]);
});

it("stores only the keys that Cookies.tsx declares as strictly necessary", () => {
  const found = new Set<string>();
  for (const { text } of [...sources, { path: "index.html", text: html }]) {
    // Matches localStorage.setItem("x", …) and sessionStorage.setItem("x", …), plus the
    // CACHE_PREFIX + path form used by photos.ts.
    for (const [, key] of text.matchAll(
      /(?:local|session)Storage\s*\.\s*setItem\(\s*["'`]([^"'`]+)["'`]/g,
    )) {
      found.add(key);
    }
    for (const [, key] of text.matchAll(/CACHE_PREFIX\s*=\s*["'`]([^"'`]+)["'`]/g)) {
      found.add(key);
    }
  }
  const unexpected = [...found].filter(
    (key) => !KNOWN_KEYS.some((known) => key === known || key.startsWith(known)),
  );
  expect(unexpected).toEqual([]);
});

it("loads no third-party tracker, which is what makes the no-banner claim true", () => {
  const offenders: string[] = [];
  for (const { path, text } of [...sources, { path: "index.html", text: html }]) {
    for (const tracker of TRACKERS) {
      if (text.includes(tracker)) offenders.push(`${path}: ${tracker}`);
    }
  }
  expect(offenders).toEqual([]);
});
