# Remedies and appeals (4c): implementation plan

Spec: `docs/superpowers/specs/2026-10-02-remedies-and-appeals-design.md`. Decisions there are
settled. Migration reaches cloud BEFORE the frontend, as always.

## Task 1: migration 0035

Two things in one migration, because they ship together.

**The hiding rule, inside `search_recipes` and nowhere else.** Exclude a recipe whose author
has `name_cleared_at is not null and public_name is null`. Read the existing function first
and add the predicate to the existing where clause rather than wrapping it. The comment must
say why it lives there: `listPublicRecipes` routes searched AND unsearched through this one
function, and a second path once bypassed every rule it held.

**The `appeals` table** exactly as the spec prints it, plus:
- a partial unique index on `(cook_id, subject_type, subject_id)` where `resolved_at is null`,
  so one appeal per subject can be open;
- RLS: a cook selects and inserts their own (`cook_id = auth.uid()`), a moderator selects all
  and updates, keyed the way the reports policies in 0028 are keyed;
- `resolve_appeal(p_appeal uuid, p_outcome text, p_note text)`, security definer, moderator
  only, which in ONE transaction sets `resolved_at`, `outcome`, `moderator_note` and, when
  granting, performs the undo: `name` nulls `name_cleared_at` and `name_cleared_reason`,
  `recipe` nulls `removed_at` and `removed_reason` on `subject_id`, `suspension` nulls
  `suspended_at` and `suspended_reason`.

Integration tests in `tests/integration/appeals.test.ts`:
- a hidden cook's public recipe does NOT come back from `search_recipes`, searched or
  unsearched, and DOES come back once a public name is set (the self-heal);
- a cook with a cleared name but a public name set is NOT hidden;
- a cook can open one appeal and not a second for the same subject;
- another cook cannot read it; a moderator can;
- granting a `name` appeal nulls `name_cleared_at` AND the recipe reappears in the feed, in
  one step;
- a non-moderator calling `resolve_appeal` is refused.

## Task 2: the notice

- `src/lib/api/profile.ts` already returns `name_cleared_at`, `name_cleared_reason` and
  `public_name`, so no new query is needed.
- A banner in `AppLayout`, in the error colour, shown while `name_cleared_at` is set AND
  `public_name` is null. Wording from the spec: what happened, that their public recipes are
  hidden from Potluck, and what to do. Links to Settings and to the appeal form.
- A quieter inline note on `Potluck`, same condition, not red.
- Not dismissible, and no new column: it describes a live state.
- Tests: the banner shows for a cleared cook with no public name, does NOT show once a public
  name is set, and never shows for an ordinary cook.

## Task 3: appeals, cook side and moderator side

- `src/lib/api/appeals.ts`: `listMyAppeals`, `createAppeal(subjectType, subjectId, body)`,
  `listOpenAppeals` (moderator), `resolveAppeal(id, outcome, note)`.
- An appeal form where the cook already sees the notice (Settings, beside the cleared-name
  notice), with the 1000 character limit enforced in the UI as well as the database.
- `/moderation` lists open appeals beside reports: who, what they are appealing, their words,
  and Grant and Decline.
- The outcome is shown to the cook where the notice was.

## Task 4: verification (not delegated)

`npx supabase db reset`, `npx tsc -b`, `npm test`, `npm run test:int`, then a browser pass on
the local stack: clear a cook's name, confirm their recipe leaves Potluck AND that the banner
says so, appeal as that cook, grant it as the moderator, and confirm the recipe returns.
