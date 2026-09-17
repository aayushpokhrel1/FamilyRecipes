# Session Handover

Living context file. At the **start** of a new session say:
> "Read HANDOVER.md and continue."

At the **end** of a session say:
> "Update HANDOVER.md."

Keep this file short and current. It is the fast path back into the project.

---

## Project in one line

A private, multi-family recipe vault (React + Supabase): families store, organize, and pass down recipes with photos, story, and provenance, with a Private/Family/Public visibility flag that seeds a later public feed. Web now, React Native later; Supabase now, self-owned Node/Express + Postgres later. See [README.md](README.md), [spec](docs/superpowers/specs/2026-09-16-family-recipes-design.md), [plan](docs/superpowers/plans/2026-09-16-family-recipes-v1.md).

## How we work (decided, do not re-litigate)

- **Token priority is the point.** Minimize Claude tokens. Implementation and review go through the **delegation pipeline** (`~/.claude/bin/delegate`), NOT Claude subagents. Opus only orchestrates (specs, routing, review adjudication) and keeps security-sensitive + tricky-debugging work in-session. See `~/.claude/CLAUDE.md` delegation section and the `/orchestrate` skill.
- **Delegate command:** `delegate deepseek --verify "<cmd>" --commit "<msg>" "<spec>"`. The worker edits files; the CLI runs verify and commits only if it passes. `free` (OmniRoute) was DOWN this build, so everything went to `deepseek` (which is the right tier for real work anyway). Point at the brief file by path in the spec so the worker reads it (cheap for us).
- **Verify gate = `npx tsc -b && npm test`** (NOT `tsc --noEmit`, which is weaker and misses unused imports + missing test globals). For DB/migration tasks the verify is a controller-run `npx supabase db reset` (needs Docker). `--verify` on Windows runs via cmd.exe: use ONE command or `&&` (cmd supports `&&`), never `;`.
- **Execution style:** subagent-driven-development flow, but implementers/reviewers are pipeline workers. Security (RLS, the join RPC, edge-function JWT), debugging, and one-liners stay in-session.
- **Writing style:** no em/en dashes anywhere (prose, comments, commits).
- **Portability seam:** ALL data access lives in `src/lib/api/`. Nothing outside it may import the supabase client. Keep it that way (a future Express+Postgres backend reimplements only that folder).

## Current status

- **v1 COMPLETE** on branch `feat/v1`. **PR #1 open:** https://github.com/aayushpokhrel1/FamilyRecipes/pull/1 (base `master`). Repo is PUBLIC.
- Production build passes (`npm run build`); **21 unit tests** (`npm test`) + **4 RLS integration tests** (`npm run test:int`, needs Docker + local Supabase) green.
- Phases done: 0 setup, 1 schema+RLS, 2 auth, 3 families, 4 recipes CRUD, 5 AI extract, 6 comments/photos/cook mode, 7 tags/app shell. Final review found + fixed 5 real bugs; 1 parked (see below).
- SDD ledger (recovery map, git-ignored scratch): `.superpowers/sdd/2026-09-16-family-recipes-v1/progress.md`.

## What works and where it lives

- Migrations `supabase/migrations/0001..0005`: schema, RLS visibility (`can_read_recipe`), storage bucket+RLS, and `0005` (join RPC + tag-write fix).
- `src/lib/api/`: auth, families, recipes, comments, photos, tags, extract, types, supabaseClient (the only createClient).
- `src/context/`: AuthContext, FamilyContext. `src/pages/`: SignIn/SignUp, RecipeList, RecipeCreate/Edit/Detail, CookMode, Families, JoinByCode. `src/components/`: AppLayout, RequireAuth, FamilySwitcher, RecipeCard, IngredientEditor, StepEditor, VisibilitySelect, TagPicker, AiPrefillPanel, CommentThread.
- Edge function `supabase/functions/extract-recipe/`: `index.ts` (Deno, validates caller JWT), `jsonld.ts` (pure, vitest-tested URL fast path), `prompt.ts`.

## Running it

- **Docker must be running** for anything DB-related.
- Start local Supabase: `npx supabase start` (first run pulls images, slow). Reset/apply migrations: `npx supabase db reset`.
- **Unit tests** (no Docker): `npm test`. **Integration tests** (Docker + Supabase up): export env then run, in one command:
  ```
  eval "$(npx supabase status -o json | python -c "import json,sys;d=json.load(sys.stdin);print('export SB_URL='+d['API_URL']);print('export SB_ANON_KEY='+d['ANON_KEY']);print('export SB_SERVICE_KEY='+d['SERVICE_ROLE_KEY'])")" && npm run test:int
  ```
- **Run the app in a browser:** create `.env.local` (gitignored) with `VITE_SUPABASE_URL=http://127.0.0.1:54321` and `VITE_SUPABASE_ANON_KEY=<ANON_KEY from supabase status>`, then `npm run dev`. NOTE: no `.claude/launch.json` yet; add one if you want `preview_start name:"..."`. The app has NOT yet been exercised end-to-end in a browser (all verification so far is build + unit + RLS integration).

## Gotchas (learned the hard way)

- **jsdom leaks supabase-js auth sessions between clients.** Integration tests must use `// @vitest-environment node` and pass `{ auth: { persistSession: false, autoRefreshToken: false } }` to every `createClient`, or a signed-in user's JWT bleeds into the service-role client. Also `npm test` is scoped to `src` so units never need Docker.
- **Joining a family cannot use a plain SELECT** (RLS blocks non-members). Use the `join_family_by_code` SECURITY DEFINER RPC (migration 0005). `joinByCode` calls `supabase.rpc(...)`.
- **`can_read_recipe()` is TRUE for any public recipe**, so recipe-child WRITE policies must check author/family-owner, not `can_read_recipe` (that let anyone retag public recipes; fixed in 0005).
- **`tsc --noEmit` < `tsc -b`.** Test files need `"vitest/globals"` in `tsconfig.app.json` types and `import "@testing-library/jest-dom/vitest"` in `src/test-setup.ts` to typecheck under the build. Use `tsc -b` as the gate.
- **Debounce only the search VALUE, not the initial load** (a debounced initial load made RecipeList's test flaky under suite load).
- **`gen_random_bytes()`** (invite codes) is pgcrypto, preinstalled on Supabase; watch it on a bare Postgres later.

## Next actions (pick per interest)

1. **Enable AI extraction (highest-leverage remaining):** `npx supabase secrets set MODEL_API_KEY=...` (and `MODEL_BASE_URL`/`MODEL_NAME` if not deepseek), then deploy/serve the `extract-recipe` function. It returns 501 until configured. Then wire the AiPrefillPanel end-to-end and verify a real extraction.
2. **Run the app end-to-end in a browser** against local Supabase (sign up, create family, add recipe manually + via paste, comment, cook mode). Add `.claude/launch.json` while you are at it.
3. **CI:** no GitHub Actions workflow yet. A `build + npm test` workflow on push/PR is a quick win.
4. **Merge the PR** (or iterate on it). After merge, the SDD workspace can be deleted.
5. **Parked / deferred (from the final review and rulings):**
   - #3 non-atomic delete-then-insert in `updateRecipe`/`setRecipeTags`: upgrade to a transactional RPC if partial-failure data loss becomes a real risk (v1 tradeoff, small lists).
   - Ingredient search deferred (v1 filters recipe title only); needs a join/RPC.
   - `getPhotoUrl` always signed URL; add a public fast-path if it matters.
   - Bundle >500kB (supabase-js); code-split later.
6. **Phase 2 (designed, not built):** the public recipe feed. The `public` visibility flag already ships; add follow/save/fork tables + a cross-family public query.

## Session log

- **2026-09-16/17 (v1 built end to end):** Brainstormed the product (private multi-family vault first; public feed as phase 2), wrote spec + plan, executed all 7 phases via the delegation pipeline (deepseek) at ~$0 Claude cost, Opus orchestrating. Mid-build the delegate CLI gained `--verify`/`--commit` (+ a Windows UTF-8 output fix), and CLAUDE.md got token-priority + precedence-over-execution-skills rules; user created the `/orchestrate` skill. Fixed the join-by-code RLS gap (SECURITY DEFINER RPC + integration test), an over-permissive tag policy, an unauthenticated-create guard, a wake-lock leak, stale-response races, and a build gate that was too weak. All migrations apply, 21 unit + 4 integration tests + production build pass. Created the PUBLIC GitHub repo, pushed master + feat/v1, opened PR #1. NOT yet done: MODEL_API_KEY/deploy for AI, end-to-end browser run, CI, merge.
