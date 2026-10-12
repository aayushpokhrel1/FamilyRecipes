import { sources } from "./sourceFiles";

// Shared by the two terms fingerprint tests, one per app. It exists because the family test
// used to find its page with sources.find(path.endsWith("pages/Terms.tsx")), and the day the
// kitchen app got a page of the same name that suffix matched two files. The glob sorts
// "../kitchen/pages/Terms.tsx" first, so the family's guard would have begun hashing the
// kitchen's document: it fails once, and pasting the printed hash in makes it pass again while
// guarding nothing. AMBIGUITY MUST THROW, not resolve.
//
// The glob lives in src/lib, so ITS OWN directory is "./" and everything else is "../":
// "./legal.ts" is src/lib/legal.ts and "../pages/Terms.tsx" is src/pages/Terms.tsx. Callers
// pass an ordinary repo path and this reconstructs one per key to compare against, rather than
// asking every caller to know where the glob happens to live.
const repoPath = (key: string): string =>
  key.startsWith("../") ? `src/${key.slice(3)}` : `src/lib/${key.replace(/^\.\//, "")}`;

export function sourceText(path: string): string {
  // A full repo path wins outright, so that "src/pages/Terms.tsx" is never ambiguous merely
  // because "src/kitchen/pages/Terms.tsx" also ends in "pages/Terms.tsx". A SHORT suffix still
  // has to be unambiguous, which is the case this function exists for.
  const exact = sources.filter((s) => repoPath(s.path) === path);
  if (exact.length === 1) return exact[0].text;

  const found = sources.filter((s) => repoPath(s.path).endsWith(`/${path}`));
  if (found.length === 0) throw new Error(`${path} matches no file in the source glob`);
  if (found.length > 1) {
    throw new Error(
      `${path} matches ${found.length} files (${found.map((f) => repoPath(f.path)).join(", ")}). ` +
        "Pass the full path: guessing would guard the wrong page.",
    );
  }
  return found[0].text;
}

/**
 * Comment lines are stripped before hashing, so that explaining the code does not re-prompt
 * every user in the world. Everything else counts, including JSX structure: a heading moved
 * from one section to another changes what people are agreeing to.
 */
export function prose(text: string): string {
  return text
    .split("\n")
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join("\n")
    .replace(/\s+/g, " ")
    .trim();
}

/** djb2. Not cryptography: this only has to change when the text changes. */
export function fingerprint(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = (((h << 5) + h) ^ text.charCodeAt(i)) >>> 0;
  return h.toString(16).padStart(8, "0");
}