# Save and fork: copying a recipe into your vault (Phase 2, sub-project 3)

Date: 2026-09-28
Status: designed, not built
Follows: `docs/superpowers/specs/2026-09-27-potluck-feed-and-follows-design.md` (sub-project 2, SHIPPED and live)

## Why this exists

Potluck lets you browse, search and follow, and then leaves you nowhere to go. You can read
another household's recipe and you cannot keep it. Everything the app does well afterwards,
the meal plan, the grocery list, Cook Mode, the cupboard match, works on recipes in YOUR
vault, so a recipe you can only read is a recipe the rest of the app cannot touch.

## The central decision, and why

**A save COPIES the recipe. It does not point at it.**

A pointer is the obvious cheap design and it is wrong here. If your vault held references,
then Mei setting her recipe back to `family` would empty part of your vault, and Mei deleting
it would empty more. The person who published has no business deciding what stays in someone
else's kitchen. A copy costs a few rows and removes that whole class of problem.

The same reasoning governs the rest of the design: **once a copy exists, nothing the original
cook does may change it.** That is why the credit line is snapshotted rather than joined, and
why photos are not referenced across recipes.

## Decisions taken

| Decision | Chosen | Why |
| --- | --- | --- |
| One action or two | **One: "Save to my vault"** | A save and a fork produce identical data; the difference was only intent. Two buttons would have been two names for one row. |
| Can a copy be published | **No, for now** | Moderation does not exist and is the stated gate on opening Potluck. Publishing copies with no takedown path is the case we are least able to defend. Deliberately reversible: one `check` constraint. |
| Credit line | **Permanent, but quiet once adapted** | Lineage is a fact, so it cannot be cleared. But a recipe you have rewritten should read as yours, so the header shrinks to a small note after the first edit. |
| Photos | **Not copied** | See below: referencing is unsafe and copying bytes is real cost for a first cut. |
| Destination | **The active family** | `FamilyContext` already holds one, localStorage-backed. No new picker. |

## Data model

Three columns on `recipes`:

```sql
alter table recipes
  add column source_recipe_id uuid references recipes(id) on delete set null,
  add column source_cook_name text,
  add column adapted_at timestamptz;
```

**`source_cook_name` is a snapshot, not a join.** Two reasons. If Mei deletes the original the
FK goes null, and a join would lose the credit entirely, which contradicts the principle above:
Mei must not be able to erase her name from a copy any more than she can erase the copy. And it
records who it came from *at the time*, which is what lineage means. The accepted cost is that
it goes stale if Mei later renames herself.

`source_recipe_id` survives for two jobs only: the uniqueness guard below, and linking back to
the original while it still exists. Display never depends on it.

Two guards, each a single point:

```sql
-- A saved copy cannot be published. Dropping this constraint is the ENTIRE change
-- if republishing is later allowed, which is why it is a constraint and not a rule
-- spread across the UI.
alter table recipes add constraint saved_copies_are_not_publishable
  check (source_recipe_id is null or visibility <> 'public');

-- Saving the same recipe into the same vault twice is a no-op, not a duplicate.
create unique index recipes_one_copy_per_family
  on recipes (family_id, source_recipe_id) where source_recipe_id is not null;
```

The unique index is per FAMILY, not per user, because the vault is a family's. Two members of
one household must not end up with two copies of the same recipe.

## The copy

`save_recipe_to_vault(p_source uuid, p_family uuid) returns uuid`, `security invoker`, so RLS
still decides what the caller may read and write. It widens no permission: the caller must
already be able to read the source and to insert into the destination family.

### It must not enumerate ingredient columns

**READ THIS BEFORE WRITING THE COPY.** `replace_recipe_children` has a fixed column list, and
that list has silently dropped a column twice: migration `0009` exists because `0006` dropped
`section`, and `0019` had to extend it again for `optional` and `alt_group`. A copy routine
written the obvious way would be a SECOND fixed list, with the same failure mode and twice the
chance of divergence: add a column, and copies quietly lose it with no error.

So the copy names no ingredient columns:

```sql
insert into recipe_ingredients
select (jsonb_populate_record(null::recipe_ingredients,
        to_jsonb(ri) || jsonb_build_object('recipe_id', v_new))).*
from recipe_ingredients ri
where ri.recipe_id = p_source;
```

Steps copy the same way. A future column is carried automatically, with no migration to
remember and no way to forget.

### What travels, and what does not

| Travels | Does not | Why not |
| --- | --- | --- |
| title, story, provenance | photos | See below |
| servings, prep and cook minutes | tags | Tag ids belong to the source family and are unreadable outside it |
| ingredients (all columns) | comments | A conversation on the original, not a property of the recipe |
| steps | cook log | Your cooking history, not theirs |

### Photos are not copied

Referencing the original's file is **unsafe and was rejected**: storage objects are foldered by
recipe id, and `recipe_photos_read` grants access via `can_read_recipe(folder)`. A copy reusing
the source path would show its photo until Mei unpublished, then go dark, which is precisely the
failure the copy design exists to prevent.

That leaves copying the bytes, which is real storage cost and a server-side copy step, or
copying nothing. **A first cut copies nothing.** The copy shows the same empty-plate placeholder
as a recipe you typed yourself, and the saver can add their own photo. Copying bytes can be
added later without changing anything built here.

## Detecting adaptation

`updateRecipe` sends the `recipes` row and the children through different paths, and an
ingredient-only edit **does not touch the `recipes` row at all** (`src/lib/api/recipes.ts`: the
row update is skipped when the patch has no recipe-level keys). A trigger on `recipes` alone
would therefore miss exactly the edit most likely to be someone's first: changing an amount.

One trigger function, fired from three tables:

```sql
create function mark_recipe_adapted(p_recipe_id uuid) ...
-- set adapted_at = now() where id = p_recipe_id
--   and source_recipe_id is not null and adapted_at is null
```

fired from `recipes`, `recipe_ingredients` and `recipe_steps`. Any edit path, present or
future, marks the copy.

**The copy RPC sets `source_recipe_id` LAST.** It inserts the new recipe with a null source,
copies the children (the trigger sees a null source and does nothing), then sets the lineage in
one final update. That final update is excluded by the trigger's `when` clause, so recording
lineage is not itself an adaptation. Without this ordering every copy would be born adapted.

## Interface

**Potluck cards.** `RecipeCard` gains `onSave?` and `saved?`. The button renders only when
`onSave` is passed, so `RecipeList` (the vault grid, the other consumer) is untouched.

The button is a **sibling of the `<Link>`, absolutely positioned inside `.plate-card`**, not a
child of it. A button inside an anchor is invalid and steals the click target; and the card's
existing comment records that a sibling in normal flow became its own grid cell, which
absolute positioning avoids. Its accessible name is per card, `Save Mei's Dal to my vault`,
not a bare "Save" repeated down the grid.

**One saved-ids query per page.** Potluck asks once which of the recipes on screen are already
in the vault, never once per card. This mirrors the `getBylines` rule the page already follows,
and gets the same kind of test.

**Recipe page.** The same button. Hidden on your own recipes and on recipes already in your
family, since both are already in the vault.

**On the copy:**

- untouched: `Saved from Mei's kitchen`, a header line
- adapted: the title stands alone, with a small `from Mei` near the story

**No family.** A user who belongs to no family has nowhere to save. The button prompts to
create a family rather than failing.

## Testing

Integration, against a real Postgres, because the risky half is RLS and constraints:

- a stranger can save a PUBLIC recipe, and the copy carries ingredients and steps
- a stranger cannot save a `family` or `private` recipe
- the copy is independent: deleting the ORIGINAL leaves the copy and its children intact
- the check constraint rejects publishing a copy
- the unique index rejects a second save into the same family
- an ingredient-only edit sets `adapted_at`, and a freshly created copy has it null
- a column added to `recipe_ingredients` is carried by the copy (guards the no-fixed-list rule)

Unit: the button's three states (savable, saved, hidden), both credit-line states, and one
`listSavedSourceIds` call per Potluck render.

**The permission and constraint tests are run red first.** A policy test nobody has seen fail
is not evidence, which this project relearned in sub-project 1 when a hole it had "found"
turned out to have been fixed a year earlier.

## Out of scope

- **Copying photo bytes.** Deliberate, see above. Addable later without rework.
- **Publishing a copy.** One constraint away when moderation exists.
- **Any count of how many people saved a recipe.** Same reasoning as follower counts: no vanity
  metric in an app about family cooking, and easy to add, hard to remove.
- **Notifying the original cook.** Nothing in the app notifies anyone yet.
- **Diffing a copy against its original**, or pulling later changes from it. A copy is a copy.
- **Moderation**, report, block, takedown: sub-project 4, and still the gate on opening Potluck.
