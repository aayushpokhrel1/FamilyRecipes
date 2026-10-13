import { expect, it } from "vitest";
// Vite's ?raw import, not node:fs, for the same reason src/index.contrast.test.ts gives: it
// keeps this test inside tsconfig.worker.json, which deliberately has no node types. Adding
// them so this one file could read the disk would also let worker/index.ts import node:fs and
// still typecheck, in a file that runs on Cloudflare's runtime and cannot.
import source from "./index.ts?raw";

// EVERY PLACE THE WORKER INJECTS RAW HTML, named and counted.
//
// `worker/index.ts` has no unit test of its own and cannot have one: HTMLRewriter is a Worker
// runtime global with no implementation under Vitest, which is why every testable helper lives
// in `meta.ts` or `site.ts`. So the file that does the injecting is the one file here nothing
// reads. This test reads it as TEXT, which needs no runtime.
//
// `{ html: true }` is the switch that turns an HTMLRewriter call from "insert this as escaped
// text" into "parse this as markup". There are exactly two, both deliberate, and each is safe
// for its own separate reason:
//
//   - the JSON-LD block, which DOES carry user input (a recipe's title, story, ingredients and
//     steps). `buildRecipeJsonLd` escapes every `<` as `<`, which is valid JSON and
//     closes the `</script>` break-out. Pinned by "escapes a </script> in the content so it
//     cannot break out of the tag" in meta.test.ts.
//   - the prerendered body fragment, which carries NO user input: it is markup that
//     react-dom/server produced at build time from this project's own components, for the four
//     static documents, and `enrichShell` will only fetch one for a path that is a key of
//     PUBLIC_PAGE_COPY.
//
// A third one would be a new sink for user-controlled text, and it would look exactly as
// reasonable in review as these two do. The count is the guard: adding one fails here, and the
// failure is the prompt to say why it is safe.
// Comment lines are dropped before counting. Both sinks carry a comment saying "html: true
// because ...", so counting the raw text found FOUR and the first version of this test was
// about to be corrected to 4: a count that includes the prose explaining the count would then
// have gone green on a new sink whose author also explained themselves.
const code = source
  .split("\n")
  .filter((line: string) => !/^\s*(\/\/|\*|\/\*)/.test(line))
  .join("\n");

it("injects raw HTML in exactly the two places that are accounted for", () => {
  const sites = [...code.matchAll(/html:\s*true/g)].length;
  expect(
    sites,
    "A new { html: true } appeared in worker/index.ts. It is a raw-HTML sink: say in a comment " +
      "there why the value cannot carry user input, add it to the list at the top of this " +
      "test, and raise this count.",
  ).toBe(2);
});

it("builds the JSON-LD through the helper that does the escaping", () => {
  // The escaping lives in buildRecipeJsonLd, so the sink is only safe while the value appended
  // to <head> comes from there. A future hand-rolled `<script type="application/ld+json">` in
  // this file would have no escaping at all, and the count above would still read 2.
  expect(code).toMatch(/jsonLd\s*=\s*buildRecipeJsonLd\(/);
  expect(
    code.includes('<script type="application/ld+json">'),
    "worker/index.ts builds a JSON-LD script tag itself instead of using buildRecipeJsonLd",
  ).toBe(false);
});

it("sends only the anon key upstream, so RLS is what decides what the Worker can read", () => {
  // The Worker reads recipes, photos, avatars and cooks on behalf of a stranger. Every one of
  // those reads is safe ONLY because the credential is the anon key and a row coming back IS
  // the proof the row is public. A service-role key here would bypass RLS in a process whose
  // output is served to the whole internet, and it would still pass every other test.
  expect(code).not.toMatch(/SERVICE_ROLE/i);
  expect(code).toMatch(/apikey:\s*env\.SUPABASE_ANON_KEY/);
});
