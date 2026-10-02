import { expect, it } from "vitest";
import { jsxSources as sources } from "./sourceFiles";

// The accessibility rules that are cheap to state and expensive to remember. src/pages/Help.tsx
// promises WCAG 2.2 AA; these are the parts of that promise a grep can hold us to.
//
// This is deliberately a source scan, not a rendered-DOM audit. It catches the mistakes that
// get made while typing JSX, which is where they are actually made, and it catches them in
// every file at once rather than only in the handful that happen to have a component test.
//
// Contrast lives in src/index.contrast.test.ts. Cookies and storage live in
// src/lib/browserStorage.test.ts.

it("gives every image an alt attribute", () => {
  // An empty alt="" is a valid, meaningful answer: it marks an image as decorative so a screen
  // reader skips it. A MISSING alt is not an answer, it makes the reader announce the filename.
  // Several alt="" in this codebase are deliberate and carry a comment saying so.
  const offenders: string[] = [];
  for (const { path, text } of sources) {
    for (const [tag] of text.matchAll(/<img\b[^>]*>/g)) {
      if (!/\balt\s*=/.test(tag)) offenders.push(`${path}: ${tag.slice(0, 80)}`);
    }
  }
  expect(offenders).toEqual([]);
});

it("never puts a click handler on a div or span, which a keyboard cannot reach", () => {
  // A <div onClick> is invisible to Tab and to Enter. The fix is always a <button type="button">,
  // which gets focus, keyboard activation and the right role for free.
  const offenders: string[] = [];
  for (const { path, text } of sources) {
    for (const [tag] of text.matchAll(/<(?:div|span|li|td|tr|p)\b[^>]*>/g)) {
      if (/\bonClick\s*=/.test(tag)) offenders.push(`${path}: ${tag.slice(0, 80)}`);
    }
  }
  expect(offenders).toEqual([]);
});

it("gives every form control a programmatic label", () => {
  // Counted, not located: a bare <input> inside a wrapping <label> is correctly labelled, and
  // this codebase uses that pattern everywhere. So the check is that the number of labelling
  // mechanisms covers the number of controls, which fails the moment someone adds an input that
  // sits outside a label and has neither aria-label nor aria-labelledby.
  const offenders: string[] = [];
  for (const { path, text } of sources) {
    const controls = [...text.matchAll(/<(?:input|select|textarea)\b/g)].length;
    if (controls === 0) continue;
    const labels =
      [...text.matchAll(/<label\b/g)].length +
      [...text.matchAll(/aria-label(?:ledby)?\s*=/g)].length +
      // A hidden file input triggered by a visible button is labelled by that button.
      [...text.matchAll(/type="file"/g)].length;
    if (labels < controls) {
      offenders.push(`${path}: ${controls} controls but only ${labels} labelling mechanisms`);
    }
  }
  expect(offenders).toEqual([]);
});

it("never ships a button whose label is only an icon or a bare symbol", () => {
  // "×", "+", "→" alone are unreadable to a screen reader and ambiguous to everyone else.
  // Either write a word, or keep the glyph and add an aria-label.
  //
  // A short WORD is fine: "Add" and "Save" are clear labels, so the check is for a label with
  // no letters or digits in it at all, not for a short one.
  const offenders: string[] = [];
  for (const { path, text } of sources) {
    for (const [, attrs, label] of text.matchAll(
      /<button\b([^>]*)>\s*([^<>{}]{1,4})\s*<\/button>/g,
    )) {
      if (/[\p{L}\p{N}]/u.test(label)) continue;
      if (!/aria-label/.test(attrs)) offenders.push(`${path}: <button>${label}</button>`);
    }
  }
  expect(offenders).toEqual([]);
});
