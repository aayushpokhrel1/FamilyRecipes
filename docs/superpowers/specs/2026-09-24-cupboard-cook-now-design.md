# The cupboard, and cooking from what is in it

## Problem

Two questions the app cannot answer today:

1. **"It is 6pm, what can I cook?"** The vault can be searched by ingredient, but only one
   ingredient at a time, and it cannot say "you have everything for this one except cumin".
2. **"Do we need more rice?"** `pantry_staples` records that a family keeps rice. It has no
   way to say the jar is empty, so a staple is either invisible to the grocery list forever or
   must be deleted and re-added.

Both are the same missing fact: what is in the kitchen right now.

## The failure mode this design is built around

A pantry feature does not fail by breaking. It fails by going quietly out of date while still
looking correct, and then recommending a chicken curry to someone with no chicken. Wrong
answers are indistinguishable from right ones, which makes a stale inventory worse than no
inventory.

So the governing constraint is not the schema. It is that every stored claim must have a
reason to be true that does not depend on anyone being diligent:

- A `keep` item claims "we keep rice in this house", which stays true for years.
- A `week` item claims "we have chicken", which is only trusted for seven days and then
  disappears on its own.

Nothing in this design asks a user to remember to tidy up.

## Decisions

1. **One list, two kinds.** `keep` items are the cupboard proper. `week` items are what is in
   right now and expire after seven days. Two lists that look alike would repeat the
   aisles-versus-sections confusion this project already paid for once.
2. **Three states: `have`, `low`, `out`.** No quantities and no expiry dates. The two chosen
   jobs do not need them, and they are the part of a pantry that rots fastest.
3. **Its own room at `/kitchen/cupboard`.** My Kitchen already carries six sections. It keeps a
   one-line actionable summary that links through.
4. **An unknown ingredient counts as missing.** No hidden "everyone has salt" set. Instead the
   cupboard is seeded on first run from the family's own recipes, so the assumption is visible
   and editable. Invisible assumptions are the class of bug this codebase keeps getting bitten
   by.
5. **Suggestions come from the family vault only, for now.** The fenced-off web shelf is
   designed (below) and deliberately not built.
6. **Rename `pantry_staples` to `pantry_items`.** Once the table holds this week's chicken the
   old name lies about its contents.

## Architecture

### Migration `0017`

Rename `pantry_staples` to `pantry_items` and add:

| Column | Type | Notes |
|---|---|---|
| `kind` | text, not null, default `'keep'` | `keep` or `week`, checked |
| `state` | text, not null, default `'have'` | `have`, `low`, `out`, checked |
| `expires_on` | date, null | null for `keep`; `today + 7` for `week` |

Existing rows become `kind='keep', state='have'`, which is exactly what they already mean, so
current staple behaviour is preserved with no data migration beyond the defaults.

RLS policies carry over unchanged (`is_family_member` for read and write). The
`unique (family_id, key)` constraint stays: one cupboard, one entry per ingredient. Promoting a
`week` item to a `keep` item is an update of `kind`, not a second row.

### Ageing out

Week items are filtered at query time: `expires_on is null or expires_on >= today`. No cron, no
sweep job. Rows accumulate slowly and cost nothing; deleting them is a later optimisation.

**All date arithmetic goes through `src/lib/dates.ts`.** Building a `YYYY-MM-DD` from
`toISOString()` shifts the day backwards in every UTC+ timezone and reads correctly in US ones,
so it ships unnoticed. This project already has that bug written down.

### `src/lib/api/pantry.ts`

Replaces `staples.ts`. All Supabase access stays inside `src/lib/api/`, per the project's
data-access boundary rule.

- `listPantry(familyId)` applying the expiry filter
- `addItem(familyId, label, kind)` storing `normalizeItem(label)` as the key
- `setState(id, state)`
- `setKind(id, kind)` for promoting a week item to the cupboard
- `removeItem(id)`
- `listRecipeIngredientIndex(familyId)` returning `{recipe_id, title, items[]}` for matching

### `src/lib/cookNow.ts` (pure)

No Supabase, mirroring how `grocery.ts` holds `buildGroceryList`.

Matching goes through `normalizeItem`, the same key the grocery grouping and the staples
already use. One matching scheme in the app, not a second one that drifts out of step.

```
haveKeys  = items where state != 'out'          // 'low' counts as had
lowKeys   = items where state == 'low'
missing   = recipe ingredient keys not in haveKeys
```

Per recipe it returns `{ recipe_id, title, total, haveCount, missing[], usesLow[] }`, ranked by
`missing.length` ascending, then `haveCount` descending, then title. Recipes missing more than
two ingredients collapse behind a "show more" rather than being hidden, so an empty-looking
result is always explained.

A recipe with no ingredients returns `total: 0` and is excluded from results rather than
counting as a perfect match. Marking that explicitly because a degenerate empty case is exactly
what shipped the unreachable cook log.

**Ceiling:** this pulls the family's recipes and ingredients and matches client side. Correct
at family scale, tens to low hundreds. A `ponytail:` comment names the upgrade to an RPC if a
vault ever passes a few hundred recipes.

### `/kitchen/cupboard`

- The list, grouped by aisle using the existing `categoryFor` from `src/lib/catalog.ts`, since
  the aisle is derived and needs no storage
- Tap an item to cycle `have` to `low` to `out`
- Add by name, with the existing catalog datalist
- A "What can I cook?" action rendering `cookNow` results
- Empty state runs the seeding flow

### Seeding, first run only

The empty state offers a tick-list built from `listFamilyIngredientNames`, ordered by how often
each ingredient appears across the family's own recipes, so salt, oil and onion rise to the
top. Ticking adds them as `keep` items. No typing, and the assumption about what a household
has is drawn from that household's real recipes rather than a curated guess.

### Upkeep hooks

These carry the design, because a cupboard behind a tap gets tended less than one on the main
page.

1. **Shopping to cupboard.** Once anything is checked in `GroceryPanel`, a "Put N items in the
   cupboard" action appears. Checked items are upserted as `week` items with `state='have'`, or
   set back to `have` if already present. **Explicit, not automatic:** one feature silently
   writing rows in another is surprising, and surprise is costly in the thing a family trusts
   for dinner.
2. **Cooked to used up.** After "Mark as cooked" in Cook Mode, show only the cupboard items
   that recipe actually used, each with quick `low` and `out` toggles. Skippable and never
   blocking.

### My Kitchen

The read-only staples strip becomes a one-line cupboard summary: "2 running low, 6 things in",
linking to `/kitchen/cupboard`. Actionable phrasing on purpose, so it pulls attention only when
there is a reason to go.

### Settings

`FamilyDataPanel` currently manages staples. Editing moves to `/kitchen/cupboard` and Settings
links there, rather than keeping two places to edit one list.

## Testing

Unit tests on `cookNow.ts` covering the rules that will actually break:

- `out` excluded from had, `low` included but reported in `usesLow`
- an unknown ingredient counts as missing
- ranking order, including the tie-breaks
- a recipe with no ingredients is excluded, not a perfect match
- an empty cupboard returns every recipe as all-missing rather than throwing

Integration test for RLS on `pantry_items`: a member of another family can neither read nor
write these rows.

**Browser pass is required, not optional.** Two bugs on 2026-09-24 were invisible to 160 green
tests. The degenerate cases here are an empty cupboard, a recipe with no ingredients, and a
result where everything is missing. None of those are visible to a test suite, and one of them
is the exact shape of the bug that shipped last week.

## Rollout

DB first, then frontend. The frontend selects `kind`, `state` and `expires_on` and would error
against the old cloud schema. This is the project's required order.

1. Migration `0017` local, `npx supabase db reset`
2. API and pure module with tests
3. Cupboard route and seeding
4. Upkeep hooks
5. My Kitchen summary and Settings link
6. `npx supabase db push` to cloud, then push to master

## Out of scope

- **Quantities and expiry dates.** Ruled out by the two chosen jobs, and the fastest-rotting
  part of any pantry.
- **Barcode scanning.** Interesting, unrelated to either job.
- **The web shelf.** Designed and deferred: external results render in a clearly separate
  section below the vault results, never interleaved, each with a "Save" that imports into the
  vault through the existing AI extraction path where it gains a photo, story and provenance.
  Building the matcher against the vault first means no API key, no quota and no third-party
  terms until the matcher is known to be worth having. Purely additive afterwards.
- **Deleting expired week rows.** Filtered at query time; a sweep is a later optimisation.
