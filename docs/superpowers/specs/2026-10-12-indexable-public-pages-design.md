# Indexable public pages: a cook's own title, and prose a crawler can read

## Why this exists

Google Search Console reported three URLs it would not index. One of them,
"Alternate page with proper canonical tag", was a real defect and is fixed in `3d00ff7`:
every route was served the one `index.html`, whose canonical was hardcoded to the site root,
so five of the seven URLs in the sitemap told Google their real address was `/`.

Two gaps survived that fix, and this spec is those two.

1. `/cooks/:handle` now canonicalises to itself but still carries the homepage's title and
   description, because `shellTags` has copy only for the four static documents and a cook's
   name lives in the database.
2. Every page ships `<div id="root"></div>` with no server-rendered body. That is the
   remaining "Crawled - currently not indexed" candidate.

### The honest uncertainty, recorded on purpose

**Prerendering is a hypothesis, not a diagnosis.** Googlebot renders JavaScript, the pages
already serve a correct title, description and JSON-LD, and the site has one public recipe
and seven URLs in total. A thin new site not being indexed is better explained by authority
and content volume than by client rendering. The canonical fix also has not had time to take
effect.

So the scope is deliberately the cheap half: the four static documents, which are pure prose
with no data dependency, where prerendering costs a build step and nothing at runtime.
`/recipes/:id` and `/cooks/:handle` stay client-rendered. **Do not widen this on the grounds
that it would be more complete** - widen it when Search Console shows a rendered-content
problem that this did not fix. A later reader who finds the data pages still client-rendered
is looking at a decision, not an omission.

## The load-bearing fact

`src/main.tsx` calls `createRoot(...).render()`, **not** `hydrateRoot()`. React discards
whatever is already inside `#root` rather than adopting it.

Everything cheap about this design follows from that one line:

- Prerendered HTML is **crawler-only**. A human sees it for a few hundred milliseconds and
  then React replaces it.
- There is **no hydration contract**, so the server tree needs no parity with the client
  tree: no providers, no matching markup, no `suppressHydrationWarning`.
- A wrong or stale fragment **cannot break the app for a person**. The worst case is a
  crawler reading prose that is one deploy old.

If anyone ever changes `main.tsx` to `hydrateRoot`, this design's safety argument is void and
the prerender becomes a source of hydration mismatches. That is why the note lives in the
code as well as here.

## Part A: a cook's own title

### What it does

`/cooks/handle` serves a title and description built from that cook's public row, instead of
"Family Recipes" and the homepage tagline.

### Where the data comes from

`public_cooks` (migration `0020`), which exposes exactly `id, handle, public_name, bio,
avatar_url` for rows with a non-null handle. It is the only public path into `profiles` and
its column list is the gate; this feature needs no change to it.

- title: `public_name`, falling back to `handle` when it is null.
- description: `bio`, falling back to a stock line. Truncated the same way a recipe story is.

### Shape

In `worker/meta.ts`, pure and tested:

- `cookHandleFromPath(pathname)` - anchored `^/cooks/([a-z0-9_]{3,30})/?$`. The same
  character class as the handle check constraint in `0020` and as the existing
  `avatarHandleFromPath`. **This pattern is the sanitiser**: the value is interpolated into a
  PostgREST filter, exactly as `avatarHandleFromPath`'s is, so nothing outside `[a-z0-9_]`
  may reach it.
- `buildCookTags({ publicName, handle, bio, origin })` returning `ShellTags`.

In `worker/index.ts`:

- `enrichShell` gains one branch. When `cookHandleFromPath` matches, it awaits the
  `public_cooks` read and overrides title and description before rewriting.
- **No row, a failed fetch, or a thrown error falls through to what `enrichShell` already
  produces**: the self-referencing canonical and the shell's own wording. A preview is a
  nicety; serving the app is not. This mirrors `enrichRecipePage`, which serves the generic
  card rather than leaking that a non-public recipe exists.

### Deliberately not doing

**No `og:image` change.** The avatar at `/avatar/:handle.jpg` is square and the card is
`summary_large_image`, so using it would crop a face badly. The card stays `og.png`. Revisit
only with a 1200x630 cook card, which is a `scripts/og-card.py` job, not a Worker one.

## Part B: prerendered prose for the four documents

### What it does

`/terms`, `/privacy`, `/cookies` and `/help` are served with their prose already inside
`#root`, rendered at build time.

### The shape, and the one rejected alternative

**Rejected: write complete HTML files** (`dist/terms.html` with title and canonical baked
in) and serve them directly. It is one fetch instead of two, but the canonical and title
logic would then exist in both the build script and `enrichShell`. This repo has paid for
second copies of the same knowledge more than once; `docs/OPERATIONS.md` and `CLAUDE.md` both
exist because of it. One extra subrequest on four low-traffic pages is the cheaper price.

**Chosen: body fragments as assets, injected at request time.**

- `src/prerender.tsx` - an SSR entry exporting a `Record<string, ReactElement>` keyed by
  path. It imports the four page components and nothing else. No providers: the pages have
  zero hooks and zero context, needing only a Router for `Link`.
- `scripts/prerender.mjs` - run after `vite build`. Wraps each element in `StaticRouter` at
  its own path, `renderToString`s it, and writes `dist/prerender/<name>.html` containing only
  the rendered element.
- `enrichShell` - when the path has a fragment, fetches it through `env.ASSETS` and does
  `setInnerContent(fragment, { html: true })` on `div#root`.

Each concern keeps one home: `enrichShell` owns canonical, title and description; the
fragment owns content.

### Staleness

The script runs inside `npm run build`, which is what Cloudflare runs on deploy, so a
fragment cannot be stale in production. `npm run dev` is Vite and never touches the Worker,
so dev is unaffected.

`dist/` is already gitignored, so nothing generated is committed and there is no second copy
of the prose to drift.

### Routing

`dist/prerender/*.html` must be reachable to `env.ASSETS` but must never be a page:

- The Worker refuses `/prerender/*` as a public path, in the same branch and for the same
  reason it already refuses `/site.html` and `/kitchen.html`. A fragment is not a document:
  it has no `<head>`, no canonical and no footer, and an indexed one would be a duplicate of
  the real page with none of its context.
- **Refusing the public path does not hide the file from `env.ASSETS`.** The refusal is a
  check on the incoming request inside `route()`; `env.ASSETS.fetch` with a Request the
  Worker constructs itself never passes through `route()`. This is exactly how `site.html`
  and `kitchen.html` are already both unreachable by URL and fetchable internally, so follow
  that pattern rather than inventing a second mechanism.
- `public/robots.txt` disallows `/prerender/`. Belt and braces, since the refusal above is
  what actually holds.

### Failure

Any non-200 from the fragment fetch leaves the shell untouched and serves it. The page then
behaves exactly as it does today. This is the same degradation rule as every other branch in
`worker/index.ts`.

## Tests, and which are mechanical guards

`npm test` runs `vitest run src supabase worker scripts`, so all of these run.

| Test | Fails when |
| --- | --- |
| `worker/meta.test.ts` | `cookHandleFromPath` accepts a handle outside `[a-z0-9_]{3,30}`, or is not anchored (the sanitiser check) |
| `worker/meta.test.ts` | `buildCookTags` drops the fallback to `handle` when `public_name` is null, or lets a description past the 160-character limit |
| `scripts/prerender.test.ts` | A path in `STATIC_SITEMAP_PATHS` has no entry in the prerender map |
| `scripts/prerender.test.ts` | A rendered fragment is empty, or does not contain the `<h1>` of its page |

The third is the one that matters most, and it is the same shape as the `PUBLIC_PAGE_COPY`
guard added in `3d00ff7`: **the sitemap is the list of promises to Google, so anything that
list names must be covered, and the test reads the real list rather than a copy of it.**

`enrichShell` itself still has no unit test, because `HTMLRewriter` has no implementation
under Vitest. That is why every testable decision is a pure function in `worker/meta.ts` and
why this spec requires a `wrangler dev` pass before deploy.

### Verification before deploy, not after

Green tests have repeatedly missed what a browser found in seconds on this project. Required,
and recorded in the plan as its own task:

1. `npm run build`, then `npx wrangler dev --local`.
2. `curl` each of the four documents and confirm the prose is in the HTML, the title is the
   page's own, and the canonical is self-referencing.
3. `curl /cooks/<a real handle>` and confirm the cook's name is the title.
4. `curl /cooks/nosuchhandle` and confirm it degrades to the shell rather than erroring.
5. Confirm `/prerender/terms.html` is refused.
6. Confirm a hashed `.js` is still served as javascript, and `/site.html` and
   `/kitchen.html` still 404.
7. Open one document in a browser and confirm the swap from prerendered prose to the React
   tree is not visibly broken.

## Out of scope

- Prerendering `/recipes/:id` or `/cooks/:handle`. See the uncertainty note above.
- Any move to `hydrateRoot` or real SSR.
- A cook `og:image`.
- Anything about site authority or content volume, which is the likelier cause of
  "Crawled - currently not indexed" and is not an engineering task.

## Deploy

Frontend and Worker only. **No migration**, so none of the ordering rules in `CLAUDE.md`
about applying migrations before the frontend apply here. Cloudflare builds and deploys on
push; nothing needs a manual `functions deploy`.

After deploy, use Search Console's "Validate fix" on the "Alternate page with proper
canonical tag" row and request indexing for the four documents.
