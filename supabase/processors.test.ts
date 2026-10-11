import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { expect, it } from "vitest";

// src/pages/Privacy.tsx says, in public, "Each one is listed here because the app actually
// sends data to it". That sentence was FALSE IN PRODUCTION for about two weeks, and this test
// exists because of it.
//
// What happened: the AI import's primary provider was switched to Google Gemini by setting the
// MODEL_BASE_URL secret. docs/OPERATIONS.md was updated. The privacy page was not, and it still
// said, under the Google heading, that Google was used for sign-in only and that "nothing else
// on this site reaches Google" while every photographed recipe card was being sent to Gemini.
// Nothing in the codebase changed, so no test, review or type check could have noticed.
//
// THE TRAP THIS CLOSES, AND WHY IT IS SHAPED ODDLY: who receives a user's recipe is a
// DEPLOY-TIME decision (a Supabase secret), not a code one. So grepping the source for fetch
// calls cannot find the answer, because the endpoint is never written in the source. The only
// place in the repo that records the real provider is docs/OPERATIONS.md, which is why this
// test reads prose rather than only code. It is a weaker guard than reading the live secret,
// and it is the strongest one that runs offline in `npm test`.
//
// WHEN THIS FAILS, you have two jobs, not one: name the company on the privacy page, and bump
// PRIVACY_UPDATED in src/lib/legal.ts so the date stops claiming the old list was current.
//
// WHEN YOU CHANGE MODEL_BASE_URL, the honest sequence is: edit Privacy.tsx, add the endpoint to
// AI_PROVIDERS below if it is new, update docs/OPERATIONS.md, deploy the page, THEN set the
// secret. Backwards means the page is a lie for as long as it takes you to notice.

const root = resolve(process.cwd());
const read = (p: string) => readFileSync(join(root, p), "utf8");

const privacy = read("src/pages/Privacy.tsx");
const operations = read("docs/OPERATIONS.md");

/** Every .ts/.tsx under a directory, recursively, excluding the tests themselves. */
function sourcesUnder(dir: string): { path: string; text: string }[] {
  const out: { path: string; text: string }[] = [];
  const walk = (rel: string) => {
    for (const entry of readdirSync(join(root, rel))) {
      if (entry === "node_modules" || entry === "dist") continue;
      const next = `${rel}/${entry}`;
      if (statSync(join(root, next)).isDirectory()) walk(next);
      else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry))
        out.push({ path: next, text: read(next) });
    }
  };
  walk(dir);
  return out;
}

const code = [...sourcesUnder("src"), ...sourcesUnder("supabase/functions"), ...sourcesUnder("worker")];

// Every AI endpoint this project has ever been pointed at, and the company name that MUST then
// appear on the privacy page. Add a row before pointing a secret at a new one. The point of
// listing retired ones (OpenRouter, NVIDIA) is that re-enabling one is a secret change with no
// diff, so the row has to outlive the configuration.
//
// EACH ROW NAMES A PRODUCT, NOT A COMPANY, AND THAT IS THE WHOLE POINT. Keying Gemini on the
// word "Google" is worthless, because the page says "Google" anyway for sign-in: the original
// bug was a page that named Google, truthfully, for the wrong reason. Written as "Google" this
// test passes while the page is still misleading. It was written that way first, and a mutation
// run (delete Gemini from the page, watch the test pass) is what exposed it.
const AI_PROVIDERS = [
  { host: "generativelanguage.googleapis.com", marker: /gemini/i, name: "Gemini" },
  { host: "api.deepseek.com", marker: /deepseek/i, name: "DeepSeek" },
  { host: "api.groq.com", marker: /groq/i, name: "Groq" },
  { host: "openrouter.ai", marker: /openrouter/i, name: "OpenRouter" },
  { host: "integrate.api.nvidia.com", marker: /nvidia/i, name: "NVIDIA" },
  { host: "api.openai.com", marker: /openai/i, name: "OpenAI" },
  { host: "api.anthropic.com", marker: /anthropic|claude/i, name: "Anthropic" },
  { host: "api.mistral.ai", marker: /mistral/i, name: "Mistral" },
  { host: "api.cerebras.ai", marker: /cerebras/i, name: "Cerebras" },
  { host: "api.x.ai", marker: /xai|grok/i, name: "xAI" },
  { host: "api.together.xyz", marker: /together/i, name: "Together" },
  { host: "api.fireworks.ai", marker: /fireworks/i, name: "Fireworks" },
];

// Hosts that appear in the code but receive no user data, so they are not processors. Each one
// needs a reason, because "it looked harmless" is how a font CDN gets added back.
const NOT_A_PROCESSOR = [
  "schema.org", // A JSON-LD vocabulary URL in a string. Nothing is ever requested from it.
  "recipes.enamelvault.com", // Our own canonical origin.
  "enamelvault.com",
  "kitchen.enamelvault.com",
  "example.com", // Fixtures and doc comments.
  "ico.org.uk", // A link we render for UK users to complain ABOUT us.
  "localhost",
  "host.docker.internal", // Local-only model endpoint for development.
  "www.w3.org", // SVG/XML namespace attribute, not a request.
  "search.google.com", // A link in OPERATIONS.md for a human to click, not a call.
  "fonts.googleapis.com", // Must stay absent from code; see the dedicated test below.
  "fonts.gstatic.com",
  // The SSRF denylist in supabase/functions/extract-recipe/limits.ts. These appear in the code
  // precisely so that `url` mode REFUSES them, so finding them here is the guard working, not a
  // leak. 169.254.169.254 is the cloud metadata address: the one address where a server-side
  // fetch of a user-supplied URL turns into stolen credentials.
  "127.0.0.1",
  "localhost.",
  "169.254.169.254",
  "evil.example", // A hostile URL in a test fixture for that denylist.
  "www.sitemaps.org", // An XML namespace attribute in the generated sitemap. Not a request.
];

it("names every AI provider the app can be pointed at", () => {
  // Scan the DOCS as well as the code, because the endpoint lives in a secret and the docs are
  // the only in-repo record of which one is live.
  const haystack = code.map((f) => f.text).join("\n") + "\n" + operations;
  const undisclosed = AI_PROVIDERS.filter(
    ({ host, marker }) => haystack.includes(host) && !marker.test(privacy),
  );
  expect(
    undisclosed.map((p) => `${p.host} is configured or documented, but Privacy.tsx never names ${p.name}`),
  ).toEqual([]);
});

it("discloses the AI import under Google, where a reader will actually look", () => {
  // THIS IS THE ORIGINAL BUG, WRITTEN AS A TEST. The page did name Google, truthfully, and the
  // sentence under that heading said Google was for sign-in and that nothing else reached it.
  // Someone worried about Google reads that entry and stops. So it is not enough for the import
  // to be disclosed SOMEWHERE on the page: while the model is Google's, the Google entry itself
  // has to say so.
  if (!/generativelanguage\.googleapis\.com/.test(operations)) return; // Not on Google today.
  const entry = privacy.slice(privacy.indexOf("<dt>Google</dt>"));
  const googleSection = entry.slice(0, entry.indexOf("</dd>"));
  expect(
    /gemini/i.test(googleSection),
    "the <dt>Google</dt> entry in Privacy.tsx must mention Gemini, not only sign-in",
  ).toBe(true);
  expect(
    /nothing else/i.test(googleSection),
    'the Google entry must not claim "nothing else" reaches Google while Gemini reads recipes',
  ).toBe(false);
});

it("sends user data to no host that the privacy page has never heard of", () => {
  const known = [...AI_PROVIDERS.map((p) => p.host), ...NOT_A_PROCESSOR];
  // Companies named on the page whose hostnames we expect to see in the code.
  const disclosed = [
    { host: "supabase.co", company: "Supabase" },
    { host: "api.resend.com", company: "Resend" },
  ];
  const hosts = new Set<string>();
  for (const { text } of code) {
    for (const match of text.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)) {
      hosts.add(match[1].toLowerCase());
    }
  }
  const unknown = [...hosts].filter(
    (h) =>
      !known.some((k) => h === k || h.endsWith(`.${k}`)) &&
      !disclosed.some(({ host, company }) => h.endsWith(host) && privacy.includes(company)),
  );
  expect(
    unknown,
    "a new outbound host appeared: either add it to NOT_A_PROCESSOR with a reason, or name the company in Privacy.tsx",
  ).toEqual([]);
});

it("keeps the typeface off Google's network, which Cookies.tsx promises in public", () => {
  // Moved off Google Fonts deliberately, because it disclosed every visitor's IP to Google on
  // page load. src/pages/Cookies.tsx states that no page makes a third-party request at all.
  // HTML COMMENTS ARE STRIPPED FIRST, and that is not cosmetic: index.html carries a comment
  // explaining that the typeface USED to come from fonts.googleapis.com, so a naive substring
  // search fails on the very comment that records the fix. Caught by this test going red.
  const strip = (t: string) => t.replace(/<!--[\s\S]*?-->/g, "");
  const html = strip(read("index.html")) + strip(read("kitchen.html"));
  const offenders = [...code, { path: "index.html + kitchen.html", text: html }]
    .filter(({ text }) => /fonts\.(googleapis|gstatic)\.com/.test(text))
    .map(({ path }) => path);
  expect(offenders).toEqual([]);
});
