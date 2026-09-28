# Operations

How to run, deploy and not break Family Recipes. Cross-cutting engineering lessons live in the Obsidian vault
(`Projects/FamilyRecipes/`), not in this repo; product truth lives in [../PRODUCT.md](../PRODUCT.md).

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

## Deployment

Three targets that are deployed **separately**. Confusing them wastes time.

| target | how | automatic? |
| --- | --- | --- |
| Frontend | Cloudflare Workers Builds, Git-connected to master | **yes**, on push |
| Database | `npx supabase db push` | no |
| Edge function | `npx supabase functions deploy extract-recipe` | **no, never** |

A commit touching only `supabase/functions/` leaves Cloudflare's last build untouched, and that
is correct rather than stale.

### Frontend

Live at <https://recipes.enamelvault.com>. `enamelvault.com` is a Cloudflare zone (Free plan)
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

### Root and www redirect

Both `enamelvault.com` and `www` have a proxied `AAAA` -> `100::` placeholder (the same discard
address Cloudflare uses; the proxy answers and the origin is never reached), plus a Single
Redirect rule in the `http_request_dynamic_redirect` ruleset (zone
`534b45be9cc7ffdd92e4792900bbec9c`, rule `59ace7314da34a3fb1b282f48e3ec99e`) sending both to
`https://recipes.enamelvault.com` with the path and query preserved.

**302, not 301, on purpose:** a 301 is cached hard by every browser that sees it, so putting a
landing page on the bare domain later would be fought by every previous visitor's cache. There
is no SEO here to trade away for that.

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

Secrets:

```bash
npx supabase secrets set MODEL_BASE_URL=... MODEL_NAME=<vision model> MODEL_API_KEY=... TRANSCRIBE_BASE_URL=https://api.groq.com/openai/v1 TRANSCRIBE_MODEL=whisper-large-v3-turbo TRANSCRIBE_API_KEY=...
```

`MODEL_NAME` **must be vision-capable** or photo mode breaks. It is currently **Gemini 3.8
Flash** via Google's OpenAI-compatibility layer.

`npx supabase secrets list` returns **digests, not values**, so a key cannot be copied between
secrets. It does return `updated_at`, which is enough to tell when the model config last
changed without ever seeing a key.

The model call is plain OpenAI-compatible `/chat/completions` with **no `response_format`** (the
JSON schema rides in the system prompt and the reply goes through `parseModelJson`), so swapping
providers is an env-only change.

To check staleness, compare the deployed `updated_at` from `npx supabase functions list`
against `git log --since="<updated_at>" -- supabase/functions/extract-recipe/`.

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
