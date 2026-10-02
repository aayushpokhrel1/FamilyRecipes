// Shared by the two audit tests that read this codebase as TEXT rather than running it:
// browserStorage.test.ts and accessibility.test.ts.
//
// Vite's import.meta.glob, not node:fs, on purpose. tsconfig.app.json deliberately has no node
// types, because app code must not be able to reach for process or fs, and a test living in
// src/ is covered by that same project. ?raw hands back the file as a string at build time.
//
// This file ships in src/ rather than next to the tests so both can share it; it is imported
// only from tests, so nothing of it reaches the bundle.
const MODULES = import.meta.glob("../**/*.{ts,tsx}", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

export type SourceFile = { path: string; text: string };

/** Every .ts/.tsx file under src/, excluding the tests themselves. */
export const sources: SourceFile[] = Object.entries(MODULES)
  .filter(([path]) => !/\.test\.tsx?$/.test(path))
  .map(([path, text]) => ({ path, text }));

/** Only the .tsx files, for checks about JSX. */
export const jsxSources: SourceFile[] = sources.filter(({ path }) => path.endsWith(".tsx"));
