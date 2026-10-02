# Working in this repo

## Where things are written down

**Before adding anything to `HANDOVER.md`, ask: will this still be true in a month?**
If yes, it belongs in a permanent doc below, not in the handover. This file exists because every
session was putting everything in `HANDOVER.md` until it reached 1,365 lines and started
contradicting itself, which caused real wrong work: a superseded line led to re-proposing a
model swap the same file recorded as already tried and rejected.

| Write it in | When it is |
| --- | --- |
| `README.md` | What the app is, what it does, the stack, links to everything else |
| `PRODUCT.md` | Product truth: who it is for, decisions, roadmap, what is deferred **and why**. **Gitignored since 2026-10-02**: the repo is public and the roadmap is the part worth keeping back. The canonical copy is in the vault at `Projects/FamilyRecipes/product/PRODUCT.md` |
| `DESIGN.md` | The visual system: tokens, type, colour, component patterns |
| `docs/OPERATIONS.md` | Running, verifying, CI, deploying, secrets, monitoring, environment traps, latent landmines |
| a **code comment at the site** | A rule about specific code ("any new ingredient column must be added here too") |
| the **Obsidian vault** | A lesson that would change how I work on a *different* project |
| `docs/superpowers/specs/` | The design of one feature, written before building it. Still tracked: a spec explains why the code is shaped as it is |
| `docs/superpowers/plans/` | The task breakdown for one feature. **Gitignored since 2026-10-02**, same reason as `PRODUCT.md`; canonical copy in the vault at `Projects/FamilyRecipes/plans/` |
| `HANDOVER.md` | **Only** current state: commit, versions, test counts, what is half-done, what is next |
| nowhere | A dated narrative of what you did today. `git log` already holds it, in detail |

`HANDOVER.md` is gitignored and local-only, so nothing durable may live there: a fresh clone or
another machine would never see it.

## Lessons have ONE home each, by reach

There is deliberately **no `LESSONS.md` in this repo**. It was tried on 2026-09-27 and deleted
the same day, because every entry was already a third copy: the codebase-specific ones were
comments at the code, and the generalisable ones were in the vault.

1. **A rule about specific code goes in a comment AT that code.** This is the most reliable form
   by a distance: you cannot edit `replace_recipe_children` without reading the warning above it.
   A doc elsewhere is the least reliable, because nobody re-reads it.
2. **A lesson that generalises goes in the Obsidian vault**, `Projects/FamilyRecipes/index.md`,
   phrased so it is useful on another project, with this one as the example.
3. **Nothing goes in both.** If something is genuinely both, the detail is the code comment and
   the generalisable half is the vault note.

The evidence for why prose docs do not work here: three bugs on 2026-09-27 had their lesson
already written down in this project before they happened. **The failure mode is not ignorance,
it is not re-reading.** Prefer a mechanical defence — a test that fails, a CI job, a grep, a
comment you cannot avoid — over a document.

**Updating docs means making them TRUE, not just appending what shipped.** Correct or strike a
stale claim where it sits rather than adding a newer entry beneath it, because the next reader
may hit the old one first. Cross-check every number (deployed version, test count, head commit)
against reality rather than trusting the file.

When asked to "update the docs", sweep all of them, not the one you happen to have open.

## The public documents, and the tests that keep them honest

`/terms`, `/privacy`, `/cookies` and `/help` are public routes, deliberately outside
`RequireAuth`: a notice you can only read after consenting is not a notice. They render
`<div className="prose plate">`, and **both classes matter**, because `.plate` carries the rule
that recolours headings. A `.prose` that styled its own surface without being a `.plate` put
bone headings on a bone plate, which is invisible, and no test caught it.

Each page makes a claim that the code has to keep true. Three tests do that, and each was
confirmed to go red before it went green:

| Test | What it stops |
| --- | --- |
| `src/index.contrast.test.ts` | A colour pair dropping below AA. It reads the REAL tokens out of `index.css`, so it cannot drift from the palette |
| `src/lib/accessibility.test.ts` | A missing `alt`, an unlabelled form control, a `<div onClick>`, an icon-only button |
| `src/lib/browserStorage.test.ts` | A cookie, a tracker, or a new storage key appearing, which is the exact moment a consent banner becomes legally mandatory |

Two things have no mechanical guard and need a human:

- **`TERMS_VERSION` in `TermsGate.tsx` must be bumped when `Terms.tsx` wording changes**, or
  nobody is re-asked and the stored acceptance is a lie.
- **`Privacy.tsx` must name every third party the app sends data to.** Adding an outbound call
  anywhere makes that page part of the change. `docs/OPERATIONS.md` has the current list.

## Project rules

- **All Supabase access lives in `src/lib/api/`.** Nothing outside it imports the client. This
  is the portability seam for a future Node/Express + Postgres backend.
- **Verify with `npx tsc -b && npm test`**, not `tsc --noEmit`. DB or migration changes also
  need `npx supabase db reset` (requires Docker).
- **The Worker, not the SPA, is what search engines and link previews see.** `robots.txt`,
  `/sitemap.xml`, canonical URLs, OpenGraph tags and JSON-LD all live in `worker/`, so none of
  them work under `npm run dev`. Pure helpers go in `worker/meta.ts` and are unit tested;
  `worker/index.ts` does the I/O and must always degrade to serving the untouched asset.
- **Apply a migration to cloud BEFORE the frontend that needs it.** A frontend commit and its
  migration are not one change: Cloudflare deploys one automatically and Supabase deploys
  neither. Getting this backwards broke every recipe save on production once already.
- **No edge function is ever deployed automatically.** There are four now, and each deploys on
  its own: `npx supabase functions deploy <name>` for `extract-recipe`, `delete-account`,
  `notify-report` or `admin`. `ACTIVE` means deployed, not runnable.
- **RLS is the entire security model, and a test now holds it.** `supabase/rls.test.ts` reads
  the migrations and fails if a table is created without `enable row level security`, without a
  policy, or if a `SECURITY DEFINER` function omits `set search_path`. A table that misses RLS
  is readable and writable by anyone holding the anon key, which ships in the JS bundle on
  purpose. `extract_log` is listed there as deliberately unpoliced, because RLS with no policy
  is the strictest setting, not a gap.
- **The Worker sends a Content-Security-Policy with `script-src 'self'`, so NO inline
  `<script>` runs.** A blocked inline script does not warn, it silently never executes, which
  is why the theme bootstrap lives in `public/theme-init.js`. `worker/meta.test.ts` pins the
  policy and `src/lib/browserStorage.test.ts` fails if an inline script returns to
  `index.html`.
- **Work on `master`** (solo project). Branch only to let CI gate something risky first.
- **Query the Obsidian vault (`Projects/FamilyRecipes/`) before a big change**, and read
  `docs/OPERATIONS.md` before any deploy. Most vault entries name a bug that recurred *after*
  its lesson was first written down.
