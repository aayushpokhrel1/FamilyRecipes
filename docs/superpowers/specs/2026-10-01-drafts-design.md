# Drafts: an unfinished recipe survives the tab closing (Phase 2, sub-project 5a)

Date: 2026-10-01
Status: BUILT 2026-10-01, verified locally in a browser on a fresh account. NOT on production yet.
Splits from: the drafts brainstorm recorded in `PRODUCT.md` ("A draft belongs to its AUTHOR")
Followed by: 5b, a pending edit to an already-published recipe, which is NOT in this spec

## Why this exists

Today the create form holds everything in React state. Close the tab, hit a flaky extraction,
or wander off mid-recipe and it is all gone. That is worst exactly where the app is most
useful: the AI fills a long form from a photo, and the cook then has to finish it in one
sitting or lose the lot.

Three things were asked for, and two of them are the same thing:

1. an unfinished create form you can come back to,
2. a staging area for AI-extracted recipes,
3. a pending edit to an already-published recipe.

**1 and 2 are one feature.** An AI-prefilled form IS an unfinished form; once a draft exists,
staging an extraction costs nothing extra. **3 is a separate sub-project** (5b), because a
draft pointing at a live recipe needs a merge step and has to answer what happens to the
public version, to copies other families already saved, and to anyone cooking from it
mid-edit. This spec covers 1 and 2 only.

## Decisions taken, not to be revisited

| Decision | Chosen | Why |
| --- | --- | --- |
| Where a draft lives | Its own table, never a flag on `recipes` | There are 11 queries against `recipes` plus `search_recipes`. A flag means teaching all 12 to exclude drafts, and that is exactly the bug that let muted cooks stay in Potluck: the rule lived in one query path and the other ignored it. |
| Who owns it | The AUTHOR alone. Only they can read it | A draft is unfinished thinking, not family property |
| Which family | A draft is NOT stored in the personal kitchen. It carries `target_family_id`, where it lands when finished | Storing it in the personal kitchen would file an edit to a shared-family recipe under a different family than the recipe itself |
| Title | **Required.** A draft always has a title | Decided 2026-10-01. It makes a draft a constrained row rather than a loose payload, and it makes the drafts list readable, which is the only way a draft is ever found again |
| Saving | An explicit "Save draft" button | Autosave is a bigger feature with its own failure modes (overwriting a better version from another tab). Deferred, see below |

## Naming, which is a real trap here

`RecipeDraft` in `src/lib/api/types.ts` ALREADY means "the shape the create form holds", and
the AI extraction returns one. The stored row is a different thing and needs a different name,
or every future reader will conflate them.

- `RecipeDraft` keeps its current meaning: **form state**, unsaved, in memory.
- `SavedDraft` is the new type: **a row**, with an id, an author, a target and timestamps.
- A `SavedDraft` CONTAINS a `RecipeDraft` as its body.

## Data model

```sql
create table recipe_drafts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references profiles(id) on delete cascade,
  -- Where it lands when finished. not null is safe ONLY because of the kitchen invariant in
  -- 0032: every cook now has at least one family, so there is always a legitimate target.
  target_family_id uuid not null references families(id) on delete cascade,
  -- 5b only. 5a NEVER sets this and enforces nothing about it. It is here because the table
  -- shape was decided with it, and adding it later would mean a second migration on the same
  -- table for a column the design already assumes.
  target_recipe_id uuid references recipes(id) on delete cascade,
  title text not null,
  -- The whole RecipeDraft minus the title: ingredients, steps, story, provenance, servings,
  -- timings, source_url, and the chosen visibility. Deliberately NOT mirrored into columns
  -- and child tables: a draft is never queried by ingredient, only listed by title and
  -- loaded whole, so columns would buy nothing and would hand us a second copy of
  -- replace_recipe_children, which has silently dropped a column twice (see 0009 and 0019).
  body jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index recipe_drafts_author_idx on recipe_drafts (author_id, updated_at desc);
```

RLS: enabled, with every policy keyed on `author_id = auth.uid()`, for select, insert, update
and delete. No family-member policy of any kind. A draft is not family property, and there is
no path by which anyone else should read one.

**The known ceiling, stated rather than hidden:** `body` is schemaless, so a future change to
`RecipeDraft` can leave an old draft's body shaped like the old version. It is written and
read by the same TypeScript type, so the risk is a missing field reading as `undefined`, not
corruption. The loader must therefore treat every field in `body` as optional and fill
defaults, and the test for that is "a draft saved with a body missing a field loads anyway".
If drafts ever need to outlive several schema changes, add a `version int` and migrate on
read; do not add it before there is a second version.

## What a cook sees

- A **Save draft** button beside Save on the create form. Disabled with its reason next to it
  when there is no title, the same pattern as the Save button fixed in `eb678cf`: a disabled
  control whose explanation is off screen is a silent failure in a different costume.
- Saving a draft from a form that was already loaded from a draft UPDATES it rather than
  making a second one. Otherwise a cook who saves three times has three drafts and no idea
  which is current.
- A **`/drafts`** page listing their drafts, newest first, by title and when it was last
  touched, each with Resume and Delete. A link to it appears on the Recipes page only when
  at least one draft exists, so it never advertises an empty room.
- **Resume** opens the create form prefilled, and finishing with Save publishes the recipe and
  then deletes the draft.

**Publish order, and what happens if it half fails:** create the recipe first, then delete the
draft. If the delete fails, the cook has their recipe and a stale draft, which is recoverable
and visible. The other order risks destroying the draft and then failing to create the
recipe, which loses the work outright. Never do it the other way round.

## Deliberately NOT in 5a

- **Autosave.** Needs a conflict story for two tabs and a "discard changes" affordance.
- **A pending edit to a live recipe.** That is 5b and is the reason for the split.
- **Sharing a draft with the family.** Drafts are personal by decision, not by accident.
- **A cap on how many drafts a cook may keep.** RLS already limits writes to the author, so
  this is a storage question, not an abuse one. Revisit if a cook ever has hundreds.
- **Photos on a draft.** The cover photo upload stays part of publishing. A draft referencing
  an uploaded file would need its own cleanup path for drafts that are never finished.
