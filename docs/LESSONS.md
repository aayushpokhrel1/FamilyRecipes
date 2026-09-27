# Lessons

Rules this project paid for. Each one is here because something shipped broken, not because it
sounded wise. Environment-specific traps are in [OPERATIONS.md](OPERATIONS.md).

Read this before a big change. Most entries name a bug that recurred **after** its lesson was
already written down.

## Verifying

**A green test suite is not evidence about anything a user sees.** Two bugs on 2026-09-24 were
invisible to 160 passing tests. Anything touching layout, contrast, or an empty/degenerate case
(no steps, no photos, no plan) needs a browser before it is believed.

**Make the check fail first.** A test or CI job nobody has watched go red proves nothing. Pin a
fix by reintroducing the bug and confirming the test fails, then restore. This caught a mutation
test of mine that "passed" while proving nothing, because the slice it moved reordered nothing.
When wiring the integration job into CI, one deliberately broken assertion produced *32 passed /
1 failed*: the split is what showed Postgres had booted, migrations had applied and the tests had
really run, rather than the job silently no-opping.

**Verify on a fresh account, before seeding.** Seeded data hides bugs that only appear when a
thing is empty.

**Name the deployed version when you confirm something.** "Tidy is confirmed working" was true of
v10 only; nothing was retested after the v11 deploy, and v11 never booted.

**Ask for the data before theorising.** The cupboard "not matching salt" cost three rounds of
reading code. Two SQL selects settled it: the recipe row said `(2 mL) salt`, so the key could
never match. The user's own data disproved a family-mismatch theory in one step.

**An absent section is not evidence of a broken lookup.** "Check you have these" vanished
entirely, which looked like the pantry query returning nothing. Salt was simply the only cupboard
item, so zero matches meant the whole block never rendered.

**Prompt adherence is model-specific.** A prompt rule verified on one model does not carry to
another. Re-run the check when `MODEL_NAME` changes.

## Deploying

**`ACTIVE` means deployed, not runnable.** `supabase functions deploy` never parses the source.
A duplicate `const` shipped fine and then returned 503 `BOOT_ERROR` on *every* request and every
mode for ~1.5 hours. `npm run lint` catches it and is in CI for exactly this reason.

**"Failed to send a request to the Edge Function" means check whether it BOOTS, first.** It
sounds like a network fault. A boot failure also answers the OPTIONS preflight, and the
gateway's error response advertises only `authorization, x-client-info, apikey`, dropping the
`content-type` our own CORS block sends. The browser then blocks the POST before it leaves. One
call answers it:

```bash
curl -s -D - -X POST <url>/functions/v1/extract-recipe -H "Authorization: Bearer <anon>" -d '{}'
```

`sb-error-code: BOOT_ERROR` is the tell. A healthy function answers its own
`{"error":"unauthorized"}` 401 instead.

**Apply the migration to cloud BEFORE the frontend that needs it reaches production.** A frontend
commit and its migration are not one change: Cloudflare deploys one of them automatically and
Supabase deploys neither. Shipping the optional-ingredients frontend ahead of migration `0019`
broke **every** recipe save with ingredients, whether or not anyone touched the new field. This
project had already written the rule down before breaking it.

**Confirm a deploy landed rather than assuming.** Compare the live bundle against a local build.
A local build will not hash-match unless `.env.local` holds the same `VITE_*` values Cloudflare
builds with, because Vite inlines them, so compare feature strings instead.

## Errors and third-party failures

**supabase-js collapses every edge-function failure into the same string** and hides the
function's own response in `error.context`. A quota error, a refused image and a model that
returned nothing all read identically as "edge function returned a non-2xx status code", which
is why that was the only thing anyone could ever report about a failed extraction. Read the real
message out of the response and throw that, falling back to raw text and only then to the
generic message.

**Retry "not now", never "never".** The model answering 503 "experiencing high demand" is the
provider being busy, not our bug. `retry.ts` retries 429/500/502/503/504 twice at 700ms then
1800ms, and **deliberately does not retry 400 or 401**: those are our request or our key and
will fail identically however many times they are sent, so retrying only delays the same error.
It lives in its own pure module with `fetch` and `sleep` injected, so it is testable without a
Deno runtime and the tests do not actually wait.

**A signed URL is a bearer token.** `createSignedUrl` mints a fresh token per call, so an `img`
src changed on every page load and the browser could never reuse bytes it already had. Remembered
URLs are cached in `localStorage` until shortly before expiry — and cleared on sign-out, because
leaving a day's worth on a shared device hands over the keys.

## Data and schema

**A fixed column list silently drops new columns.** `replace_recipe_children` deletes and
re-inserts every child row, naming columns explicitly. Migration `0009` exists solely because
`0006` did this to `section`: no error, no clue, just gone on the first edit. Any new ingredient
column must be added there too. `tests/integration/child_replace.test.ts` now fails if one is
not.

**Use a key, not a reference, for anything that survives a delete-and-reinsert.** `alt_group` is
a text key rather than an id because `replace_recipe_children` regenerates ids on every save, so
an id link would die immediately and a position link would need remapping on every reorder. A key
travels with its row.

**Ask what reads a field back.** Tags could be set and used to filter, but `RecipeDetail` never
displayed them, so tagging looked useless. Photos had the identical shape: written everywhere,
displayed almost nowhere. *What reads this back?* is worth asking of every new field.

**Normalization must not guess.** A wrong merge silently drops an ingredient, which is worse than
not merging: `normalizeItem` refuses to equate `coriander` and `cilantro` because one often means
the ground seed. It strips a parenthesised group **only when it contains a digit** (`(2 mL) salt`
is a leaked quantity; `chicken (thighs)` is a real distinction). `Salt and pepper, to taste` is
two ingredients on one line and is deliberately left alone, because splitting on "and" would
wreck genuine single-name items.

## React

**Two `setState` calls in one tick that spread the same render closure will clobber each other.**
`StepEditor` calls `onChange` and `onIngredientsFound` in the same tick; both pages used
`setDraft({ ...draft, X })`, so the second wrote back the steps from *before* the first.
Dictated steps were silently lost on save while the box still looked right, because the child
owns its own text. **Every `setDraft` on both pages is the updater form now**, not just the
offending pair, since any two landing in one tick collide the same way.

**Pin this kind of bug at the page level**, asserting on what reaches the API, because that is
the only place it was ever visible.

**An entry point must never be gated on having content.** The cupboard summary was written as
`{activeFamily && pantry.length > 0 && ...}`, but that section was the *only* link to
`/kitchen/cupboard`, so the feature was unreachable for exactly the families who had never set it
up. A read-only strip may hide when empty; a doorway may not. Empty is when the doorway matters
most. **This has happened three times** (family-creation RLS, "Mark as cooked" with no steps,
this). When adding a link to a new page, ask what renders when the target is empty.

**A control that reveals nothing is worse than no control.** "Show 2 more days" rendered whenever
hidden days existed, but a day with no covering plan renders nothing, so the button visibly did
nothing. Gate a reveal on there being something to reveal.

## CSS and theming

**Never share a colour between a plate and the wall.** The app has two grounds: `.plate` (bone,
so `--ink`) and the wall (dark green, so `--on-wall`). A rule that sets one colour for both will
be wrong on one of them.

**Make the ground win by specificity, not source order.** `.staples summary, .plans summary` set
`color: var(--ink)` for both and beat the correct `.plans` rule above it purely by being later in
the file. The pattern that works is a wall base plus a `.plate X` override (0,2,1 over 0,1,1),
mirroring the existing `.plate h2, .plate h3`.

**Dark mode hides light-mode contrast bugs.** `--ink` is *light* in dark mode, so a wrong `--ink`
on the wall looks fine there and is invisible in light mode. Check both.

**A class is not on one ground because one of its callers is.** Having just fixed the above, I
pinned `.staples summary` to `--ink` on the claim that it "sits inside GroceryPanel's
section.plate" — while `UpcomingGroceryPanel` renders the same markup on the wall. That measured
**1.23:1**, i.e. invisible, and reproduced the bug one component over in the same session that
fixed it. **Grep every component that renders a class before giving it a colour.**

Classes rendered on both grounds by the grocery panels: `aisle`, `staples`, `grocery-list` (and
its `small`), `qty`, `chip`, `vault-note`, `form-error`. Any new colour on those is the same bug
waiting.

**Contrast that passes AA can still read as broken.** Aisle headings at 0.74rem uppercase in
`--ink-soft` measured 5.71:1 and still looked greyed-out rather than like headings. Small
uppercase text needs full-strength colour.

**Check a themed style in a browser, not by reading the cascade.** A throwaway `public/_harness/`
page that loads the real `/src/index.css` through `npm run dev` and prints `getComputedStyle()`
is the way to do it without a signed-in session. Navigate to `/_harness/index.html` explicitly,
since `/_harness/` hits the SPA fallback. **Delete it afterwards; it must never be committed.**

## Working with docs

**Stale docs cause wrong work.** A superseded line describing the vision model as a rate-limited
OpenRouter route (it had been Gemini since the day before) led to re-proposing a Groq swap that
the same file recorded as already tried and rejected.

**Updating docs means making them true, not just appending what shipped.** Correct or strike the
old claim where it sits; do not add a newer entry beneath it, because the next reader may hit the
old one first.

**Check the defaults you inherited.** The tab icon was still the starter kit's purple lightning
bolt, and `public/icons.svg` shipped 8K of unused scaffolding to every visitor, because nobody
had looked. Scaffolding is not neutral: it ships.

**A public catalogue is not an entitlement.** Groq's public docs list a vision model; that
account's model list contains none. Check the account, not the vendor's marketing.
