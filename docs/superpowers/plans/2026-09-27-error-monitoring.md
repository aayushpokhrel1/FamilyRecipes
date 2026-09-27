# Error monitoring: implementation plan

Spec: `docs/superpowers/specs/2026-09-27-error-monitoring-design.md`. Read its Decisions
section before changing anything here; the awkward-looking choices (insert-only, anon inserts,
no UI, no uptime code) are all deliberate.

Verify each task with `npx tsc -b` and `npm test`. `npm run lint` is now in CI and covers
`supabase/functions/`; run it too.

## Task 1: migration `0018_error_log.sql`

Create `supabase/migrations/0018_error_log.sql` with the table from the spec's Schema section.

- `create table error_log (...)` with exactly those columns and defaults.
- `alter table error_log enable row level security;`
- ONE policy: `create policy error_log_insert on error_log for insert to anon, authenticated
  with check (user_id is not distinct from auth.uid());`
- **No select/update/delete policy.** Add a comment saying the absence is the point, so nobody
  "fixes" it later by adding a read policy.
- Add a `ponytail:` comment naming the ceiling: no rate limit, anon may insert, upgrade path is
  a trigger-side limit or moving inserts behind an edge function.

Do NOT apply it to cloud. Applying is a separate, human step (Task 5).

## Task 2: `src/lib/api/errorLog.ts`

Export `reportError(context: string, err: unknown): void`.

Requirements, all from the spec's Client section:
- Returns void. Never returns a promise the caller must handle, never throws, never awaits.
- Internally: build the row, call `supabase.from("error_log").insert(...)`, and swallow every
  failure including a rejected promise.
- A module-level `reporting` flag guards against reporting a failure of the reporter itself.
- A module-level counter caps at 20 per page load; after that, do nothing.
- `message` from `err instanceof Error ? err.message : String(err)`, truncated to 2000 chars.
  `stack` truncated to 4000. Both null-safe.
- `url` is `window.location.pathname` ONLY, never the full href (the spec says why).
- `user_agent` from `navigator.userAgent`, guarded for environments without it.
- Do not set `user_id`: the column defaults to `auth.uid()`, and the RLS check requires the row
  to match the caller. Sending it from the client would just be a value the database already
  knows.

Match the house style in `src/lib/api/`: a comment explaining WHY above anything non-obvious,
not what the line does.

## Task 3: tests for `errorLog.ts`

`src/lib/api/errorLog.test.ts`, mocking `../supabaseClient` the way `photos.test.ts` does.

Cases (each must fail if the behaviour is removed):
1. A normal call inserts one row with the right `context` and `message`.
2. **An insert that rejects does not throw**, and the caller keeps running.
3. After 20 calls, the 21st inserts nothing.
4. A failure inside the reporter is not itself reported (assert insert count, not absence of a throw).
5. `url` is the pathname, not the full href including query or hash.
6. A non-Error value (a string, an object) still produces a usable `message`.

Reset the module between tests (the cap and the guard are module state) with
`vi.resetModules()` and a dynamic import, as `RecipeCreate.test.tsx` does.

## Task 4: wire the call sites

- `src/main.tsx`: `window.addEventListener("error", ...)` and `"unhandledrejection"`, each
  calling `reportError("window:error", ...)` / `reportError("window:unhandledrejection", ...)`.
- Add `reportError(<context>, err)` inside the EXISTING catch blocks on these paths, next to the
  `setError` that is already there. Do not change what the user sees.
  - `src/pages/RecipeCreate.tsx` submit -> `save:recipe-create`
  - `src/pages/RecipeEdit.tsx` submit -> `save:recipe-edit`
  - `src/components/AiPrefillPanel.tsx` run() -> `extract:${mode}`
  - `src/components/StepEditor.tsx` the recorder callback -> `extract:audio`, handleTidy -> `extract:text`
  - photo upload failures on create/edit -> `photo:upload`
  - `src/pages/SignIn.tsx` (and the sign-up/reset paths in the same area) -> `auth:<action>`
- **Do not add it to every catch block in the app.** The list above is the whole scope.

Then one page-level test: a failed save reports once with context `save:recipe-create`. Put it
in `src/pages/RecipeCreate.test.tsx` beside the existing ones.

## Task 5 (Aayush, not delegable): apply and verify

1. `npx supabase db push` to apply `0018` to cloud. Confirm with `npx supabase migration list`.
2. Force one real error in the live app (easiest: sign in with a wrong password) and confirm a
   row lands, by running `select * from error_log order by created_at desc limit 5;` in the
   Supabase SQL editor.
3. Set up the external uptime monitor, per the settings written into HANDOVER:
   - the site root, expecting 200
   - `https://ghcclshgdtbystosfzjl.supabase.co/functions/v1/extract-recipe`, **expecting 401**,
     which is the check that would have caught the dead function
