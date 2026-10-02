import { expect, it } from "vitest";
import { sources } from "./sourceFiles";
import html from "../../index.html?raw";
import css from "../index.css?raw";

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

// The font used to come from fonts.googleapis.com, which handed every visitor's IP to Google on
// every page load. It is now served from public/fonts/, and src/pages/Cookies.tsx says in public
// that NO page makes a third-party request. This is what keeps that sentence true.
//
// Deliberately matches on real references (a <link href>, a CSS url()) rather than on the
// hostname appearing anywhere, because the comments explaining this decision name the host they
// are warning you about, and a substring search would fire on those.
it("loads no stylesheet, font or other subresource from a third-party host", () => {
  const offenders: string[] = [];

  for (const [tag, href] of html.matchAll(/<link\b[^>]*\bhref=["']([^"']+)["'][^>]*>/g)) {
    // canonical and alternate DECLARE a URL, they do not fetch one, so an absolute href there
    // is correct and carries no privacy cost. Everything else (stylesheet, preload, preconnect,
    // icon, manifest) makes the browser open a connection.
    if (/\brel=["'](canonical|alternate)["']/.test(tag)) continue;
    if (/^https?:|^\/\//.test(href)) offenders.push(`index.html <link> -> ${href} (${tag.slice(0, 40)})`);
  }
  for (const [, src] of html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/g)) {
    if (/^https?:|^\/\//.test(src)) offenders.push(`index.html <script> -> ${src}`);
  }
  for (const [, url] of css.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)) {
    if (/^https?:|^\/\//.test(url)) offenders.push(`index.css url() -> ${url}`);
  }
  for (const [, url] of css.matchAll(/@import\s+(?:url\()?\s*["']([^"']+)["']/g)) {
    if (/^https?:|^\/\//.test(url)) offenders.push(`index.css @import -> ${url}`);
  }

  expect(offenders).toEqual([]);
});

// The Worker sends a Content-Security-Policy with script-src 'self', which blocks every inline
// <script>. A blocked inline script does not warn, it simply never runs, so the theme bootstrap
// that used to live in index.html is now /theme-init.js. This is what notices if one comes back.
// The policy itself is pinned in worker/meta.test.ts.
it("has no inline script in index.html, which the CSP would silently block", () => {
  const inline = html.match(/<script(?![^>]*\bsrc=)[^>]*>/g) ?? [];
  expect(inline).toEqual([]);
});
