# A pending edit to a recipe that is already published (Phase 2, sub-project 5b)

Date: 2026-10-01
Status: SPEC, not built
Follows: `docs/superpowers/specs/2026-10-01-drafts-design.md` (5a, BUILT)

## Why this is a separate sub-project

5a stores an unfinished recipe that does not exist yet. Nobody can be reading it, nothing
points at it, and finishing it is an insert. **An edit to a LIVE recipe is none of those
things.** The recipe is on screen for other people, it may be public, other families may have
saved a copy, and someone may be cooking from it right now. Finishing is not an insert, it is
a merge against a row that can have moved underneath you.

The table already supports this: `recipe_drafts.target_recipe_id` exists, nullable, and 5a
never sets it.

## What the live recipe does while an edit is pending

**Nothing.** The recipe is untouched until the edit is published. That is the whole point of a
pending edit and it answers three of the four questions at once:

| Who | What they see while an edit is pending |
| --- | --- |
| Anyone reading the public page | The published version, unchanged |
| A family member | The published version, unchanged |
| Someone in cook mode right now | The published version they loaded. Cook mode reads once, so a publish lands on their next open, never mid-step |
| Another family's saved copy | Untouched, permanently. `save_recipe_to_vault` made an independent COPY, not a reference. Publishing an edit never reaches it, by design: a saved recipe is theirs now, with `source_recipe_id` recording only where it came from |

The copy answer is worth stating because it looks like a decision and is not one: it was
settled when save-and-fork chose copying over referencing.

## The decision that was open: a recipe that moved underneath you

`recipes_update` in `0003_recipes.sql` lets **the author OR any family owner** update a
recipe. So two people can hold a pending edit to the same recipe, and one can publish while
the other's draft is still open.

**Decided 2026-10-01: warn, then let them choose.** Not silent last-write-wins, which is
what editing does today and what would quietly destroy someone's work, and not a lock, which
a forgotten draft would hold forever.

Mechanically:

- `recipe_drafts` gains `base_updated_at timestamptz` (nullable, null for a 5a create draft),
  set to the recipe's `updated_at` at the moment the edit was started.
- Publishing compares it to the recipe's current `updated_at`. Equal means nothing moved, so
  publish. Different means someone else published in between, so **refuse and say so**, with
  the choice to publish anyway (overwriting) or keep the draft and look first.
- The refusal uses the CUSTOM SQLSTATE `DRF01`, and the custom part is load bearing. The
  obvious choice, `serialization_failure` (40001), means "transient, try again" to everything
  above Postgres: PostgREST retries that class, so the refusal never reached the caller and
  the test hung for its full timeout instead of failing. **A code meant to be read by the
  client must be one no layer in between already has an opinion about.**
- The comparison and the write happen **in one transaction, in SQL**, not as a read in the
  client followed by a write. A check in the client is a race with a smaller window, not a
  fix, and the window is exactly when two people are editing, which is the only time this
  matters at all.

## A taken-down recipe cannot be republished by editing it

Moderation treats a takedown as a state, not a deletion: the recipe stays in its author's
vault, editable and cookable, and stops being public. The author must not be able to walk
around that by publishing a pending edit that sets `visibility` back to public, which is
exactly what 0028 already guards against on a direct update.

**No new code is needed for this, and that is worth checking rather than assuming.** 0028
enforces it with a TRIGGER, `enforce_publish_rules`, not with a policy or a check inside one
update path. A trigger fires on every update to `recipes`, so a publish RPC written in 5b is
covered the moment it writes, without knowing the rule exists. 0028's own comment explains
why it was built that way: a policy can be silently changed by a later migration, as 0006
proved by dropping a column.

So 5b adds a TEST and no guard: publishing a pending edit that sets `visibility` to public on
a recipe with `removed_at` set must fail with the trigger's own message. If that test ever
goes green by accident, the trigger has been weakened and the test is the alarm.

## What a cook sees

- The edit form (`/recipes/:id/edit`) gains **Save draft**, beside Save, the same shape as the
  create form in 5a: disabled without a title, with the reason beside the button.
- `/drafts` shows an edit draft differently from a new one, because they are different things:
  "Editing **Sel roti**" against a plain title. Resume opens `/recipes/:id/edit?draft=<id>`.
- Publishing from a resumed edit updates the recipe and deletes the draft, in that order, for
  the same reason as 5a: a failed delete leaves a stale draft, the other order loses the work.
- When the recipe moved underneath the draft, publishing shows what happened and offers
  **Publish anyway** or **Keep my draft**. The wording says the recipe changed since this edit
  was started, not something vague about a conflict.

## Deliberately NOT in 5b

- **A diff of what changed.** Showing the two versions side by side is a real feature with its
  own design. The warning says the recipe moved; it does not yet show how.
- **Merging field by field.** Publish anyway is whole-draft. Field-level merge needs a diff
  first.
- **Telling the other editor their publish was overwritten.** There is no notification system
  for this and inventing one here would be out of scope.
- **Editing someone else's recipe.** Unchanged: `recipes_update` already decides who may edit,
  and a draft does not widen it.
