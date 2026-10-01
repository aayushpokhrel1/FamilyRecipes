# Pending edits (5b): implementation plan

Spec: `docs/superpowers/specs/2026-10-01-pending-edits-design.md`. The decisions there are
settled, including "warn, then let them choose" for a recipe that moved underneath a draft.

Migration reaches cloud BEFORE the frontend, as always.

## Task 1: migration 0034, the column and the publish

1. `alter table recipe_drafts add column base_updated_at timestamptz;` nullable, because a 5a
   create draft has no recipe to be stale against. Comment that null means "not an edit".
2. `publish_recipe_edit(p_draft uuid, p_force boolean default false) returns uuid`,
   **security invoker**, so `recipes_update` keeps deciding who may edit. The function widens
   the QUERY, never the permissions, which is the stance `save_recipe_to_vault` documents.
   In one transaction:
   - load the draft by id (RLS already limits it to its author); raise if missing, and raise
     if `target_recipe_id` is null, because publishing a create draft is not this path;
   - `select updated_at ... for update` on the target recipe, which is the lock that makes
     the check and the write atomic;
   - unless `p_force`, raise when the recipe's `updated_at` differs from `base_updated_at`,
     with the custom `errcode = 'DRF01'` so the client can tell this apart from a real
     failure and offer the choice. NOT `serialization_failure`: PostgREST retries that class,
     which turns the refusal into a hang;
   - apply title and the scalar columns from the draft, set `updated_at = now()`;
   - replace children through the EXISTING `replace_recipe_children`, never a second copy of
     that logic: its own comment records that a hand-written column list has silently dropped
     a column twice;
   - delete the draft, and return the recipe id.

Integration tests in `tests/integration/pending_edits.test.ts`:
- a clean publish updates the recipe, replaces its ingredients and deletes the draft;
- a recipe that changed since the draft was started is REFUSED, and the draft survives;
- the same case with `p_force` true succeeds;
- **a taken-down recipe (`removed_at` set) cannot be published back to public.** No new guard
  is written for this: `enforce_publish_rules` from 0028 is a trigger and already fires. The
  test exists so that if the trigger is ever weakened, something goes red;
- a cook who is neither author nor family owner cannot publish an edit (RLS, not the
  function, is what stops them, and the test proves the stance holds).

## Task 2: API and UI

- `src/lib/api/drafts.ts`: `saveEditDraft(recipeId, draft, familyId, visibility, baseUpdatedAt, id?)`
  and `publishEdit(draftId, force)`. The `serialization_failure` code is translated here into
  something the UI can branch on, in the api layer, not in a component.
- `/recipes/:id/edit`: a **Save draft** button beside Save, disabled without a title with the
  reason beside it, and `?draft=<id>` resumes. Publishing calls `publishEdit`; on the stale
  error it shows what happened with **Publish anyway** and **Keep my draft**.
- `/drafts`: an edit draft reads "Editing <title>" and resumes to the edit page. A create
  draft is unchanged.

## Task 3: verification (not delegated)

`npx supabase db reset`, `npx tsc -b`, `npm test`, `npm run test:int`, then a browser pass:
start an edit, change the recipe in a second session, try to publish, see the warning, publish
anyway, confirm the recipe changed and the draft is gone.
