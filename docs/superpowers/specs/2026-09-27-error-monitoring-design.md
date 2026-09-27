# Error monitoring

Today a production failure is invisible until a person hits it and says so. This session
produced two: the edge function was dead for ~90 minutes, and a save silently discarded
dictated steps. Neither left a trace anywhere.

## What this does and does not buy

**Caught:** anything that throws. A failed save, a rejected upload, a model rate limit, a
genuine crash. The dead edge function threw, so it would have been recorded.

**Not caught:** the save bug. Nothing threw; the wrong data was assembled in React state before
any call was made, so even comparing what was sent against what came back would have compared
two matching wrong values. **No error monitor of any design catches that class.** What protects
it is a test at the boundary that asserts what reaches the API, which is what
`RecipeCreate.test.tsx` now does. `RecipeEdit` has no test file at all, and that is the real
remaining gap. It is named here so nobody later mistakes monitoring for coverage.

## Decisions (settled 2026-09-27, do not relitigate)

1. **Our own table, not a third party.** An error message here can contain a recipe title, an
   ingredient, or an email. Sentry would mean shipping that to someone else's servers plus
   ~30 kB into a bundle with only four runtime dependencies. A table we already own, behind
   RLS, costs nothing new and keeps family data inside the family's database.
2. **The table is INSERT-ONLY from the app.** Clients get an insert policy and no select policy,
   so nothing can read it back through the app. Aayush reads it in the Supabase SQL editor.
   This deletes the entire "errors screen in Settings" feature, which is where the bulk of the
   work would otherwise have gone, and it sidesteps deciding which family member may read
   everyone else's failures. An error message is not something a family member should be able to
   mine for another household's recipe titles.
3. **`anon` may insert, not just `authenticated`.** A sign-in failure is exactly the kind of
   thing worth seeing, and at that moment `auth.uid()` is null. The cost is that an unauthenticated
   caller can write rows. Accepted deliberately: see the ceiling in Decision 6.
4. **Uptime is NOT built.** A free external monitor does it better, and crucially it lives
   outside the app: a site that is down cannot report that it is down. The useful trick is to
   point the monitor at the edge function and **expect HTTP 401** - a booting function answers
   its own 401, while the dead one answered 503 `BOOT_ERROR`. That catches today's exact failure
   with no auth, no secret and no cron. Setup instructions go in HANDOVER, not in code.
5. **AI failures are not a separate feature.** They are the same call with a `context` of
   `extract:image` and friends, so the extraction chain gets its own label for free.
6. **No rate limiting, and this is the known ceiling.** A crash loop could insert continuously,
   and an anonymous caller could write junk. The mitigation is a per-page-load cap in the client
   (Decision 7), which bounds the honest case but not a hostile one. If the table is ever
   flooded, the upgrade is a rate limit in a database trigger or moving inserts behind an edge
   function. Recorded as a `ponytail:` comment on the migration.
7. **Reporting never throws, never blocks, and never recurses.** It is fire-and-forget: a failure
   to report an error must not itself surface an error, or a broken monitor takes the app down
   with it. It must not report its own failures. It is capped per page load (20) so a render loop
   cannot write thousands of rows or saturate the network.

## Schema

`supabase/migrations/0018_error_log.sql`:

| column | type | note |
| --- | --- | --- |
| `id` | uuid pk, default `gen_random_uuid()` | |
| `created_at` | timestamptz, default `now()` | |
| `user_id` | uuid null, default `auth.uid()` | null for a signed-out failure |
| `context` | text not null | call site, e.g. `save:recipe-create`, `extract:image` |
| `message` | text not null | |
| `stack` | text null | |
| `url` | text null | `window.location.pathname`, not the full href |
| `user_agent` | text null | browser quirks have already mattered here (EXIF orientation) |

RLS: enabled; one `insert` policy for `anon` and `authenticated` with
`check (user_id is not distinct from auth.uid())`, so a caller can only attribute a row to
themselves. **No select, update or delete policy at all**, which is what makes it insert-only.

`url` is the pathname only: a full href on `/recipes/:id` is a recipe id, and ids in an
unreadable table are harmless but pointless.

## Client

`src/lib/api/errorLog.ts`, exporting `reportError(context: string, err: unknown): void`.

- Synchronous signature, fires and forgets. Callers never await it and never handle it failing.
- Wraps everything in try/catch and swallows. A guard flag prevents reporting a failure of the
  reporter itself.
- Caps at 20 reports per page load.
- Truncates `message` and `stack` to a sane length so one enormous model response cannot write a
  megabyte row.

Wired at:
- `window.onerror` and `window.onunhandledrejection`, in `src/main.tsx`, for genuine crashes.
- The catch blocks that already call `setError` on the paths that matter: recipe create, recipe
  edit, AI extraction, photo upload, and auth. **Not every catch block in the app** - the goal is
  the paths where a silent failure costs a person their work, not blanket coverage.

Most errors in this app are caught and displayed rather than left to crash, so
`window.onerror` alone would have seen almost nothing. That is why the call sites are explicit.

## Testing

- `reportError` never throws when the insert rejects.
- It stops after the cap.
- It does not report its own failure.
- It sends the pathname, not the full href.
- A page-level test that a failed save reports once with the right context.

## Out of scope

An errors UI, alerting on in-app errors, rate limiting, log retention or pruning, and uptime
checking in code. Retention becomes worth revisiting only if the table ever grows enough to
notice.
