# Operations

How to run, deploy and not break Family Recipes. Cross-cutting engineering lessons live in the Obsidian vault
(`Projects/FamilyRecipes/`), not in this repo; product truth lives in `PRODUCT.md`, which is gitignored and kept in the vault.

## Running it locally

Docker must be running for anything DB-related.

```bash
npx supabase start
```

```bash
npx supabase db reset
```

`db reset` applies every migration from scratch. Frontend config goes in `.env.local`
(gitignored):

```
VITE_SUPABASE_URL=http://127.0.0.1:54321
VITE_SUPABASE_ANON_KEY=<local ANON_KEY from npx supabase status>
```

Then `npm run dev`. `.claude/launch.json` exists, so `preview_start name:"dev"` works.

`enable_confirmations = true` is set in `supabase/config.toml`, so a locally created account
needs its confirmation link from Mailpit (<http://127.0.0.1:54324>). Users created through the
admin API with `email_confirm: true` skip that.

AI extraction locally:

```bash
npx supabase functions serve extract-recipe --env-file supabase/functions/.env
```

`supabase/functions/.env` (gitignored) holds `MODEL_*` and `TRANSCRIBE_*`.

## Verifying a change

```bash
npx tsc -b && npm test
```

Use `npx tsc -b`, **not** `tsc --noEmit`. DB or migration changes additionally need
`npx supabase db reset`.

**`tsc -b` deliberately excludes `supabase/functions/`** (they are Deno: remote URL imports,
`Deno.serve`, `.ts` specifiers), and `functions deploy` does not typecheck either, so a bad
file there ships silently and answers 503 BOOT_ERROR on every mode at once. That happened once
from a duplicate `const body`. `npm test` covers it now:
`supabase/functions/extract-recipe/boots.test.ts` parses AND binds every file in that
directory, and two of its own tests prove it can go red. Before 2026-09-30 a comment in
`index.ts` claimed that guard existed while nothing in the suite read the directory at all, so
if you add another edge function, give it the same test rather than trusting the deploy.

Integration tests need three env vars the script does not inject, mapped from
`npx supabase status -o env`:

| export | from |
| --- | --- |
| `SB_URL` | `API_URL` |
| `SB_ANON_KEY` | `ANON_KEY` |
| `SB_SERVICE_KEY` | `SERVICE_ROLE_KEY` |

Without them every integration file fails with "supabaseUrl is required", which is a missing
export and not a code bug.

```bash
npm run test:int
```

## CI

`.github/workflows/ci.yml`, on pushes to master and on pull requests. Two jobs:

- **build-and-test**: `npm run lint`, `npm run build`, `npm test` on Node 22.
- **integration**: boots Supabase via `supabase/setup-cli` + `supabase start`, then
  `npm run test:int`. `supabase start` applies every migration on a fresh Postgres, so a
  migration that will not apply cleanly fails here instead of on the cloud.

`npm run lint` is the **only** check covering `supabase/functions/`. `npm run build` typechecks
the app and deliberately excludes the edge function because it is Deno, and
`supabase functions deploy` uploads source without parsing it. A syntax error there deploys
fine and then fails to boot on every request.

CI only triggers on master pushes and PRs, so a plain feature-branch push fires nothing. To gate
a branch without opening a PR, temporarily add it to `push.branches` (e.g. `'ci/**'`) and strip
that line before merging.

### Reading a CI failure that is not a failure

**A job with `conclusion: cancelled`, an empty `runner_name` and no steps never ran.** It is
not your code. GitHub reports the whole RUN as "failure" when any job is cancelled, so the
mail says CI failed for a job that executed nothing.

This happened repeatedly on 2026-10-05, and GitHub had an open incident saying so: "delays
when assigning GitHub-hosted runners to Actions jobs". Jobs sat queued and were killed at
almost exactly fifteen minutes, twice with the integration job alone and once with both.

How to tell the two apart in one command, rather than guessing from the email:

```bash
gh api repos/<owner>/<repo>/actions/runs/<run-id>/jobs   --jq '.jobs[] | "\(.name): \(.conclusion) runner=\(.runner_name)"'
```

An empty runner means it never started: re-run it (`gh run rerun <id> --failed`), and check
<https://www.githubstatus.com/api/v2/incidents.json> before spending any time on the code. A
real failure names a runner and has steps, and `--log-failed` prints something.

The workflow sets `concurrency: ci-${{ github.ref }}` with `cancel-in-progress`, so only the
newest commit on a branch is ever queued. That creates no capacity; it stops stale runs
competing for scarce runners, and it means a cancellation is usually one we asked for by
pushing again. **The honest signal while CI is unavailable is the local suite**, which is the
same commands: `npm run lint`, `npx tsc -b`, `npm test`, and `npm run test:int` with the three
`SB_*` variables exported.

## Deployment

Three targets that are deployed **separately**. Confusing them wastes time.

| target | how | automatic? |
| --- | --- | --- |
| Frontend | Cloudflare Workers Builds, Git-connected to master | **yes**, on push |
| Database | `npx supabase db push` | no |
| Edge function | `npx supabase functions deploy <name>`, one at a time | **no, never** |

A commit touching only `supabase/functions/` leaves Cloudflare's last build untouched, and that
is correct rather than stale.

### The exception to "migration first", and what it cost

The standing rule is that a migration reaches cloud BEFORE the frontend that needs it, because
getting it backwards once broke every recipe save on production. **A migration that changes
what a cook SEES, rather than what the frontend may call, inverts that rule.**

`0035_remedies_and_appeals.sql` was the example. It hides a name-cleared cook's public recipes
from Potluck, and the banner explaining that was a later task, so pushing it alone would have
made recipes vanish with nothing on screen saying why. Both halves shipped on 2026-10-02 and
cloud is now at **0038**.

**The part worth keeping: the handover said 0035 was local-only, and it was wrong.** 0035 had
been pushed. A bug was found in it and corrected IN PLACE on the strength of that sentence,
which would have fixed nothing on production while making the local migration history disagree
with what the remote had actually run. `npx supabase migration list --linked` caught it during
the deploy, and the correction became `0036_hiding_rule_is_catalogue_only.sql`.

**So: `npx supabase migration list --linked` is the ONLY authority on what is applied. Run it
before editing any migration file.** If the version appears under `remote`, it is immutable:
write the next number instead. A document, this one included, can be stale; the remote cannot.

The two ordering tests, both of which 0035 hit:

- Does this migration change what someone SEES without the frontend? Then ship them together.
- Does the committed frontend CALL something only the migration creates? Then the migration
  goes first, since Cloudflare builds the frontend by itself on a push to master.

The four functions are `extract-recipe`, `delete-account`, `notify-report` and `admin`.
Deploying one does not deploy the others, and nothing warns you that a function is running
older code than the repo holds.

### Frontend

Live at <https://recipes.enamelvault.com>, with the landing page at
<https://enamelvault.com>. `enamelvault.com` is a Cloudflare zone (Free plan)
and `recipes.` is attached to the `familyrecipes` worker as a **Custom Domain**, so Cloudflare
provisioned the proxied `AAAA` and the certificate itself.

`https://familyrecipes.aayus-pok.workers.dev` still serves the same worker and **must not be
retired**: links already sent to family point at it.

Nothing in the repo hardcodes an origin, and `requestPasswordReset` builds its redirect from
`window.location.origin`. The custom domain is deliberately **not** in `wrangler.jsonc`; a
`routes` block would be a second source of truth for something Cloudflare already holds.

Build variables are set in Cloudflare:

```
VITE_SUPABASE_URL=https://ghcclshgdtbystosfzjl.supabase.co
VITE_SUPABASE_ANON_KEY=<publishable key sb_publishable_...>
```

`VITE_SUPABASE_URL` must be the **base project URL**: not the `/rest/v1` Data API URL, and no
trailing slash. `assertEnv` strips a trailing slash defensively.

### Root and www: the marketing surface

**The bare domain is no longer a redirect.** `enamelvault.com` is a custom domain on the same
`familyrecipes` Worker and serves the landing page. The Single Redirect rule that used to send
every bare-domain path to the app (ruleset `http_request_dynamic_redirect`, zone
`534b45be9cc7ffdd92e4792900bbec9c`, rule `59ace7314da34a3fb1b282f48e3ec99e`) is gone.

That rule was deliberately a **302 and not a 301** so this change would be possible: a 301 is
cached hard by every browser that saw it, and putting a page here later would have been fought
by every previous visitor's cache. The decision paid for itself.

`route()` in `worker/index.ts` branches on hostname before anything else. The bare host answers
exactly three things itself and 302s everything else to the app host, path and query preserved,
which is what the old rule did for every path and why links people already hold still work:

| On `enamelvault.com` | Answer |
| --- | --- |
| `/` | the landing page, `public/site.html` with the recipe rack injected |
| `/robots.txt`, `/sitemap.xml` | its own, from `worker/site.ts`, not the app's |
| `/favicon.svg`, `/og.png`, `/fonts/*.woff2` | served here, from the asset store |
| anything else | 302 to the same path on `recipes.enamelvault.com` |

**Why the assets are served and not redirected, which cost a live defect on 2026-10-10.**
They are the same files on the same Worker, so redirecting them looks harmless. It is not: a
302 to the app host makes them CROSS-ORIGIN, and `font-src 'self'` and `img-src 'self'` then
refuse them. The live page rendered in the Georgia fallback, the mark was blocked and `og.png`
pointed at a redirect, so the share card broke. It still answered 200 throughout. `isSiteAsset`
in `worker/site.ts` is the allowlist; **add a file to `site.html` and you must add it there**,
and it must stay an allowlist, or this host starts serving the app's `index.html` and bundle.

**`www` is a redirect, not a second Worker host.** `www.enamelvault.com` has its own proxied
`AAAA -> 100::` and the Single Redirect rule (now matching `http.host eq
"www.enamelvault.com"` only) sends it to the apex with path and query preserved, still 302.
The Workers custom-domain form REFUSES `www.enamelvault.com` with "No zones match" and then
offers to onboard it as a new zone: **do not accept that**, it would create a second zone
competing with the one holding the MX and DKIM records. `isSiteHost` still accepts `www`, so
pointing it at the Worker later needs no code change.

**`/site.html` is 404 on BOTH hosts, deliberately.** It is an asset, so it is fetchable by
path, but it is not a page: on the app host it is a stray one nobody meant to publish, and on
the bare host it is the landing page with its rack placeholder still in it. The refusal sits
ABOVE the host branch so the bare host answers 404 directly instead of redirecting a crawler
into a dead end.

**If you ever remove the custom domain, put a redirect rule back in the same motion**, or the
apex answers nothing at all.

**Cloudflare Web Analytics injects a beacon script into this page**, from
`static.cloudflareinsights.com`. Our own CSP (`script-src 'self'`) blocks it, so no data
leaves and the page's "no analytics" line stays true, but it is true BY ACCIDENT: relax the
CSP and the claim silently becomes false. Turn the injection off at the zone rather than
relying on the CSP to keep a public promise honest.

**The trap when attaching the custom domain.** The API refuses with `100117: Hostname already
has externally managed DNS records` while the hand-made `AAAA -> 100::` placeholder is still
on the hostname. A Worker custom domain CREATES its own identical `AAAA -> 100::` proxied
record, which is why `recipes` has one, and Cloudflare will not adopt one it did not make. The
placeholder has to be deleted first, which means the hostname answers nothing for the seconds
in between, so delete and attach in one motion and be ready to recreate the record if the
attach fails. The dashboard does this for you behind a "replace existing DNS records" prompt;
the API does not, which makes the dashboard the easier path here.

**Do not touch the `MX` and `TXT` records on the apex while doing this.** They are Cloudflare
Email Routing and the SPF and DKIM for `moderation@enamelvault.com`, and the landing page's
one business contact link now depends on that address delivering.

A proxied `AAAA`-only record still gets Cloudflare IPv4 anycast answers, so v4-only clients are
fine. A stale `NXDOMAIN` in a local resolver can hide `www` for a few minutes; that is caching,
not the record.

### Database

```bash
npx supabase db push
```

Linked to project ref `ghcclshgdtbystosfzjl`. **Never** `db reset --linked` now that there is
real data. Check what is actually applied with `npx supabase migration list --linked` and look
for `"remote":""`.

### Edge function

```bash
npx supabase functions deploy extract-recipe
```

**This deploy now has a HARD prerequisite: migration 0031 must be on the database first.**
Since 2026-10-01 the function calls `claim_extraction()` for a per-cook rate limit, and it
**fails closed**: when that function cannot be reached it answers 503 rather than spending a
model call it cannot account for. Deploy the function to a database without 0031 and every
extraction breaks at once, in every mode. "Migration before frontend" was always the rule
here; this one makes it mandatory rather than merely wise.

The limits themselves are **10 extractions a minute and 60 a day per cook**, plus payload
size caps and a host check with a 2MB read cap on `url` mode. All of them are knobs,
documented where they live: the rate limits in `supabase/migrations/0031_extract_rate_limit.sql`,
the sizes and the host rules in `supabase/functions/extract-recipe/limits.ts`. Raise them
there if a real cook is ever refused. A cook who hits the limit sees the sentence in the
reply body, because `src/lib/api/extract.ts` surfaces the function's own `error` string.

The host check closes a server-side request forgery hole: before it, `url` mode would fetch
any address the caller named, including loopback and the cloud metadata address. It cannot
stop DNS rebinding, and it says so at the code rather than implying a guarantee it does not
make.

Secrets:

```bash
npx supabase secrets set MODEL_BASE_URL=... MODEL_NAME=<vision model> MODEL_API_KEY=... TRANSCRIBE_BASE_URL=https://api.groq.com/openai/v1 TRANSCRIBE_MODEL=whisper-large-v3-turbo TRANSCRIBE_API_KEY=...
```

`MODEL_NAME` serves text, url AND photo, and **must be vision-capable** or photo mode breaks.
It is currently **Gemini 3.8 Flash** via Google's OpenAI-compatibility layer.

**An optional second provider, used only when the first says "not now"** (added 2026-09-30,
after a free-tier 429 and a 503 from the same model within an hour both ended a recipe
mid-add):

```bash
npx supabase secrets set FALLBACK_MODEL_BASE_URL=https://api.deepseek.com/v1 FALLBACK_MODEL_NAME=deepseek-chat FALLBACK_MODEL_API_KEY=...
```

Leave these unset and behaviour is exactly as before. It is tried only on a status that can
fix itself (429, 500, 502, 503, 504); a 400 or 401 is our bug or our key, so a second provider
would fail identically and the first error is the one reported.

**`FALLBACK_MODEL_VISION=true` is required before a PHOTO will ever use the fallback.** Vision
cannot be detected, only declared, so the default is "cannot see": without the flag a photo
that fell back would spend a request earning a 400 and then report that instead of the real
reason the first provider failed. DeepSeek has no vision, so with a DeepSeek fallback you
leave this unset and photos simply do not fall back.

**The provider's error body never reaches the browser.** It goes to the function logs
(`npx supabase functions logs extract-recipe`), and the cook sees wording plus a way out. If
someone reports "the recipe assistant is busy", the real status is in those logs.

**`url` mode trims the page before the model.** It used to send the entire raw HTML, which
could exhaust a per-minute INPUT-token quota in one request. `htmlText.ts` strips to visible
text and caps at 12k characters, keeping any `ld+json` first, because that is where modern
recipe sites put the recipe and a naive script strip measured zero characters on a real page.

`npx supabase secrets list` returns **digests, not values**, so a key cannot be copied between
secrets. It does return `updated_at`, which is enough to tell when the model config last
changed without ever seeing a key.

The model call is plain OpenAI-compatible `/chat/completions` with **no `response_format`** (the
JSON schema rides in the system prompt and the reply goes through `parseModelJson`), so swapping
providers is an env-only change.

To check staleness, compare the deployed `updated_at` from `npx supabase functions list`
against `git log --since="<updated_at>" -- supabase/functions/extract-recipe/`.

### The `admin` function, and why it exists at all

```bash
npx supabase functions deploy admin
```

Everything the moderator console shows beyond the report queue needs the service-role key, so
none of it can be done from the browser:

- emails and last-sign-in live in `auth.users`, which RLS does not expose at all;
- `profiles_self_read` hides every OTHER profile row, from moderators too, so even a
  moderator's own client cannot list users;
- suspending, promoting and deleting are auth-admin or cross-row writes.

**The security model, which is the part not to change.** The caller is identified from their
verified JWT, never from the request body, and the moderator flag is read with THEIR OWN
client, so RLS is what proves the claim. The service-role client is created only after that
check passes and never decides who the caller is. A non-moderator gets 404 rather than 403, so
the endpoint cannot even be confirmed to exist.

Report-driven actions deliberately stay in the `resolve_report` RPC, so a report changes state
in one place and there is one audit trail rather than two.

**There is no audit log.** A suspension or a deletion leaves no record of who did it or when.
With one moderator that is tolerable; with two it is not, and it is the first thing to add if
anyone else ever gets the flag.

If the console is unreachable, every action it performs can be done directly in SQL. The
runbook for that is kept outside the repo, in the Artifact linked from the session notes, and
the queries are reconstructible from the tables listed above.

## Monitoring

- **Errors:** an insert-only `error_log` table (migration `0018`), written by
  `reportError(context, err)` from the ten catch blocks where a failure costs someone their
  work, plus `window.onerror` / `unhandledrejection`. **There is no select policy**, so nothing
  reads it back through the app: read it in the Supabase SQL editor. That is deliberate and
  should not be "fixed" by adding a read policy, because a message can carry another
  household's recipe titles. `anon` may insert because a failed sign-in is worth seeing and
  `auth.uid()` is null at that moment.
- **Uptime:** two HEAD checks, `https://recipes.enamelvault.com/` and
  `https://recipes.enamelvault.com/health/extract`, both expecting 200. **Not the Supabase URL:**
  an unauthenticated request to a Supabase function is rejected by the gateway with 401 before
  the function starts, so healthy and dead both answer 401 and the monitor stays green through
  an outage. `worker/health.ts` probes the function with OPTIONS, which it answers in its own
  first branch above the auth check, so a 204 proves the isolate parsed, booted and ran our
  code.
- **Ceiling:** `error_log` has no rate limit and `anon` can write. The client caps itself at 20
  per page load, which bounds the honest case, not a hostile one. If it floods, add a limit in a
  trigger or put inserts behind an edge function.

## Environment gotchas

- **`insert().select()` + a membership-gated SELECT policy fails for the creator.** The
  RETURNING applies the SELECT policy to the new row, and a family creator is not a member yet.
  Fixed in `0007` (creator reads via `created_by = auth.uid()`). Integration tests missed it
  because they used the service-role client, which bypasses RLS.
- **pgcrypto on cloud:** `gen_random_bytes` is not on the cloud migration role's search_path.
  `0001` uses `create extension pgcrypto with schema extensions` and calls
  `extensions.gen_random_bytes`.
- **Edge function CORS must allow `authorization, x-client-info, apikey, content-type`.**
  supabase-js sends `apikey` and `x-client-info`; missing them means the preflight fails and you
  get "Failed to send a request to the Edge Function". Local Kong masks this; it only bites on
  cloud.
- **vitest's forks pool crashes on Node 20** (`webidl.util.markAsUncloneable`). CI uses Node 22.
- **jsdom leaks supabase-js auth sessions between clients.** Integration tests use
  `// @vitest-environment node` plus `{ auth: { persistSession: false, autoRefreshToken: false } }`.
- **Every integration test MUST start with `// @vitest-environment node`.** `vitest.config.ts`
  sets `environment: "jsdom"` globally for the app's component tests, so a file without the
  pragma gets jsdom. In jsdom a `Blob` is a *jsdom* Blob, which undici's `fetch` cannot consume
  as a request body: a storage upload then **never completes**, and the test dies on whatever
  timeout it has rather than erroring.
  Four files added on 2026-09-28 omitted the pragma and cost two red CI runs. It passed on
  Windows and hung on the Linux runner, which made it look environmental.
  **Reproduced and isolated** in a `node:22` container against the same database, with the
  environment as the only variable: `@vitest-environment node` passed in 298ms, the jsdom
  default hung until timeout. Raising the timeout does not help, because it is not slowness.
  Integration tests touch a database and never a DOM, so jsdom is wrong for them anyway.
- **Storage treats replacing a file as an UPDATE.** A bucket policy with only
  insert/select/delete lets the first upload succeed and fails every replacement after it.
- **Joining a family** goes through the `join_family_by_code` SECURITY DEFINER RPC, because RLS
  blocks a plain select.
- **Supabase `updateUser({ password })` does not ask for the current password**, so anyone at an
  unlocked machine is an account takeover. `changePassword` re-authenticates with
  `signInWithPassword` first. The comment there exists because the re-auth looks redundant and
  would otherwise be deleted as dead code. `setNewPassword` (recovery) deliberately does not
  re-auth: Supabase has already put a recovery session in place.
- **Aayush's shell is Windows PowerShell 5.1, where `&&` is a parse error.** One command per
  block, or `cmd1; if ($?) { cmd2 }`.
- **Disconnecting the repo in Workers Builds DELETES the build configuration**, not just the Git
  link: config, trigger and every build environment variable go together, and queued builds are
  cancelled. A "just reconnect it" fix silently drops the `VITE_*` vars, and the next build
  deploys a frontend whose `assertEnv` throws on load, which is worse than the stale deploy it
  was meant to fix. Reconnecting does not restore the old settings. **Read the config back after
  any reconnect and diff it.** Restoring needs no dashboard: `PATCH
  /accounts/{acct}/builds/workers/{script_tag}` with a full `production_settings` block.
- **Build env vars live on the CONFIG, not the trigger.** A trigger can report
  `environment_variables: {}` while builds it starts resolve both vars correctly, because they
  are read from `production_settings` when the build is queued. Check a queued build's
  `build_trigger_metadata.environment_variables` instead.
- **Resend has moved off Amazon SES to `forge.rmta.net`,** so SPF is two CNAMEs, not MX plus a
  `v=spf1` TXT. Every guide describing SES records is stale. The CNAMEs **must stay DNS-only**;
  Cloudflare defaults a new CNAME to Proxied, and a proxied CNAME breaks mail.
- **Inbound mail: `moderation@enamelvault.com` forwards to a Gmail via Cloudflare Email
  Routing** (enabled 2026-10-01). The zone had NO MX and no root SPF before that, so every
  message to the address `/terms` publishes was being dropped at the edge with no bounce and
  no trace. Routing adds three root MX records (`route1/2/3.mx.cloudflare.net`), a root
  `v=spf1 include:_spf.mx.cloudflare.net ~all`, and a `cf2024-1._domainkey` DKIM record.
  **Root SPF does not touch sending**, which goes out as `noreply@mail.enamelvault.com`: SPF
  is per exact name and does not inherit, so `send.mail.enamelvault.com` keeps its own record.
  That was checked against the actual `from:` in `notify-report` rather than assumed.
  Forwarding is only as good as its destination: the destination address must stay verified in
  Cloudflare, and if it is ever removed, mail starts disappearing silently again.
- **DMARC deliberately has no `rua=`.** A reporting address on a different domain needs an
  authorisation record at that domain, which Gmail does not publish, so reports would be
  silently discarded.

## Landmine: custom aisles would be silently dropped

Not a live bug. It becomes one the moment family-editable aisles ship.

`ingredient_categories.category` is free text, so an aisle outside the curated list is already
storable. `groupIngredientsByCategory` in `src/lib/groupIngredients.ts` handles that correctly,
appending unrecognised aisles before `Other`. **Three other places keep only curated aisles** and
would drop those ingredients entirely:

- `src/components/GroceryPanel.tsx` — `CATEGORY_ORDER.filter((c) => byAisle.has(c))`
- `src/components/UpcomingGroceryPanel.tsx` — same shape
- `src/pages/Cupboard.tsx` — `[...CATEGORY_ORDER, "Other"].filter(...)`

No dropdown offers a non-curated value today, so nothing can write one. The fix is to share the
rule `groupIngredientsByCategory` already implements rather than keep four copies of which one is
right. The open design fork was: layer family rows over the curated list (recommended) versus
seed-and-replace.


## Search engines: how Google actually finds this

Nothing needs to be bought or installed for Google to index the site, but it will not happen
on its own as fast as it should. Three things make it work, and two of them are one-off manual
actions nobody can do from this repo.

### What the code already does

- **`public/robots.txt`** allows crawling, blocks every signed-in and per-user route, and
  points at the sitemap. It is a static asset, so it needs no Worker code.
- **`/sitemap.xml`** is built by the Worker on request from live data: the five public pages,
  every public recipe that has not been removed, and every public cook. It is cached for an
  hour.
- **Canonical URLs.** `index.html` carries a canonical link and `rewriteTags` rewrites it per
  recipe, so `/recipes/<id>` cannot compete with itself through a tracking parameter.
- **JSON-LD `Recipe` data** is injected into each recipe page, which is what makes Google
  eligible to show a rich result (photo, times, ratings slot) instead of a plain blue link.
- **Real titles and descriptions in the HTML.** This is the part people get wrong with a SPA:
  a crawler does not run JavaScript reliably, so a page whose title is only set by React is a
  page Google sees as blank. The Worker writes these before the HTML is served, which is why
  `enrichRecipePage` exists at all and why it must keep degrading to the untouched asset
  rather than failing.

### The manual steps, which nobody in this repo can do for you

1. **Verify the domain in Google Search Console** at <https://search.google.com/search-console>,
   using the DNS TXT method on `enamelvault.com` since Cloudflare already holds the zone.
2. **Submit BOTH sitemaps**, because the two hosts each have their own:
   `https://recipes.enamelvault.com/sitemap.xml` (the recipes, the cooks, and the four public
   documents) and `https://enamelvault.com/sitemap.xml` (the landing page, one URL). Google
   re-reads them on its own afterwards; neither needs resubmitting per recipe.
3. **Request indexing for `https://enamelvault.com/` once.** That is the root worth indexing.
   The app host's `/` is behind `RequireAuth` and bounces a crawler to `/signin`, which is why
   it was removed from `STATIC_SITEMAP_PATHS`: do not put it back.

Bing has the equivalent at Bing Webmaster Tools and can import the Search Console setup.

### What to expect, honestly

A new domain with few inbound links is indexed slowly, typically days to a few weeks, and
being indexed is not the same as ranking. Recipe queries are among the most competitive on the
web. The realistic goal here is that people who search for this site, or for a recipe they were
sent a link to, find it, not that it outranks an established recipe publisher.

### Checking it after a deploy

```bash
curl -s https://recipes.enamelvault.com/robots.txt
```

```bash
curl -s https://recipes.enamelvault.com/sitemap.xml | head -20
```

Rich results can be checked at <https://search.google.com/test/rich-results> against any
public recipe URL. **The Worker is what serves both of these, so neither works from
`npm run dev`**: Vite serves `robots.txt` as a static file but knows nothing about
`/sitemap.xml`. Test them against a deployed preview or production, not locally.

## Compliance: the three claims the code has to keep true

The public pages make statements about this app. Each is backed by a test rather than by
anyone remembering, because the failure mode is never ignorance, it is not re-reading.

| The claim | Where it is made | What holds it up |
| --- | --- | --- |
| No cookies and no trackers, so no consent banner | `src/pages/Cookies.tsx` | `src/lib/browserStorage.test.ts` |
| WCAG 2.2 AA | `src/pages/Help.tsx` | `src/index.contrast.test.ts`, `src/lib/accessibility.test.ts` |
| The processors we name are the processors we use | `src/pages/Privacy.tsx` | Nothing. This one is manual, see below |

**Adding analytics, an embed, or any non-essential storage makes a cookie banner legally
mandatory**, and `browserStorage.test.ts` is wired to go red at that moment. When it does, the
job is two things, not one: add the banner, and correct `Cookies.tsx`.

**The processor list is the weak link.** There is no mechanical check that
`src/pages/Privacy.tsx` names every third party the app sends data to, and the easy ones to
forget are the ones nobody thinks of as a processor: the Google Fonts stylesheet in
`index.html`, the error log in `src/lib/api/errorLog.ts`, and the transcription API in
`extract-recipe`. If you add an outbound call to anything, that page is part of the change.

### Cloudflare Web Analytics is ON, and the tests cannot see it

Enabled at the ZONE level with auto-install since 2026-09-25, so Cloudflare injects the RUM
beacon at the edge and it never appears in `index.html`. **`browserStorage.test.ts` therefore
cannot detect it**, and did not: the pages claimed "no analytics at all" for a week while it was
running. That claim is now corrected on `/cookies` and `/privacy`.

It is cookieless and sets no identifier, so the no-banner position is unaffected and remains
correct. But the general lesson stands: **a source scan cannot see anything the edge injects.**
Anything switched on in the Cloudflare dashboard is invisible to every test in this repo, so
dashboard changes are a documentation obligation, not just a config change.

Turn it off, or check what it collects:

```bash
npx wrangler@latest --version
```

The toggle is in the Cloudflare dashboard under Web Analytics, or via
`GET /accounts/<id>/rum/site_info/list` on the API.

### Security headers and the CSP

Every response the Worker returns carries a Content-Security-Policy and the cheap headers
(`X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, HSTS). They are applied by
wrapping the whole router rather than per response, so a new route cannot ship without them.

**But the Worker does not see every request.** Cloudflare serves anything matching a real file
in `dist/` straight from its asset store and never invokes the Worker, so for a day the headers
reached `/help` and `/sitemap.xml` (no matching file, so they fall through) and never reached
`/`, which is `index.html`. `assets.run_worker_first: true` in `wrangler.jsonc` is what fixes that.

**It must be `true` and never a list of routes.** An array means "run the Worker first ONLY for
these paths", and every other path is then served by the asset layer alone, where
`not_found_handling` returns `index.html` without the Worker ever running. Setting
`["/", "/index.html"]` was tried and broke production inside a minute: `/sitemap.xml` began
answering with the SPA shell as `text/html`, and every shared recipe link lost its per-recipe
OpenGraph tags. Both still returned 200, so nothing looked wrong.

Two symptoms worth recognising, because both read as something else:

- **A header on some paths and not others, where the bare paths are exactly the ones that
  exist as files in `dist/`.** That is routing, not caching. Purging the cache does nothing,
  and the purge is what wasted the time here.
- **A Worker route answering `200` with the wrong `Content-Type`.** That is the asset layer's
  SPA fallback replying in the Worker's place, not a bug in the Worker.

After any change to the `assets` block, check a Worker-only route and not just the page you were
fixing:

```bash
curl -sS -D - -o /dev/null https://recipes.enamelvault.com/sitemap.xml | grep -i content-type
```

**`script-src 'self'` means no inline `<script>` anywhere.** A blocked inline script does not
warn, it silently never runs, which is why the theme bootstrap moved out of `index.html` into
`public/theme-init.js`. Two tests hold this: `worker/meta.test.ts` pins the policy's directives,
and `src/lib/browserStorage.test.ts` fails if an inline script reappears in `index.html`.

`style-src` has to allow `'unsafe-inline'`, because several components set a `style={{...}}`
attribute and CSP counts those as inline styles. That is a far weaker allowance than inline
script.

After a deploy, confirm the header is actually arriving:

```bash
curl -sS -D - -o /dev/null https://recipes.enamelvault.com/ | grep -i content-security-policy
```

If a page ever half-works in production, check the browser console for a CSP violation before
assuming a code bug: a violation reads as "Refused to load/execute", names the directive, and
is the fastest possible diagnosis once you think to look.

### Known standing risks

- **Account 2FA is on for Google, Cloudflare, GitHub and Supabase** (done 2026-10-02;
  Cloudflare's was verified through the API, not taken on trust). That closes the single
  largest risk, which was that one Google account was the recovery route for all four.
  **Still open, in rough priority order:** a separate moderator-only account so that an XSS in
  the everyday session cannot list every email; a backup story, because `delete_user` is
  irreversible and a bad `UPDATE` in the SQL editor has no undo; an audit log for admin
  actions; a rate limit on the `admin` function, which `claim_extraction` already models for
  extraction; Supabase's leaked-password protection toggle; Dependabot; and an audit of
  Cloudflare API tokens and GitHub PATs.
- **No page makes a third-party request, and that is now load-bearing.** The typeface is
  served from `public/fonts/` (SIL Open Font License 1.1, text kept beside the files because
  redistribution requires it), after being moved off Google Fonts, which was disclosing every
  visitor's IP to Google. `src/pages/Cookies.tsx` states this in public, so reintroducing any
  external stylesheet, font, embed or script makes that page false and a consent banner
  arguable. `src/lib/browserStorage.test.ts` fails on any absolute-URL `<link>`, `<script src>`
  or CSS `url()`, which is the check that notices.
- **The AI import sends user content outside the UK and EU**, to DeepSeek by default and to
  Groq for voice. It is disclosed on the privacy page and it is the only path by which user
  content leaves our own infrastructure. Changing `MODEL_BASE_URL` changes who receives it,
  so that env var is a privacy decision, not just a config value.
- **`TERMS_VERSION` in `src/components/TermsGate.tsx` must be bumped whenever `Terms.tsx`
  changes.** Nothing enforces it. Shipping wording without a bump means the stored
  `terms_accepted_at` claims people agreed to text they never saw.
- **The contact address `moderation@enamelvault.com` appears on all four public pages**, via
  `src/lib/legal.ts`. A data protection policy naming a dead mailbox is worse than one naming
  none, so if inbound mail routing changes, that constant and `MODERATION_EMAIL` move together.
