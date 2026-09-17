# Family Recipes — v1 Design

**Date:** 2026-09-16
**Status:** Approved design, pre-implementation

## Summary

A private, multi-family recipe vault. Families store, organize, and pass down
recipes with photos, story, and provenance. Recipes carry a visibility flag
(Private / Family / Public) so a public recipe-only community feed can be added
later without a migration. Web first (React + Supabase), designed so a React
Native app and a future self-owned Node/Express + Postgres backend are cheap to
add.

## Goals

1. A family can collect its recipes in one shared place and see who created and
   adapted each one.
2. Adding a recipe is easy: a guided manual form, or an AI pre-fill from pasted
   text, a URL, a photo of a card, voice, or freeform writing.
3. Nothing is public unless the author chooses it (single visibility control).
4. Portability: minimal lock-in to Supabase; the migration path to a custom
   backend is a known, bounded seam.

## Non-goals (v1)

- The public feed itself (only the `public` flag ships; feed is phase 2).
- Meal planning, auto shopping list, native RN app, in-family reactions beyond
  comments.
- Ratings marketplace, video, monetization, nutrition tracking, AI recipe
  *generation* (we structure existing recipes, we don't invent them).

## Decisions

| Decision | Choice | Why |
|---|---|---|
| v1 focus | Private multi-family vault | Lowest risk; the emotional core. Feed is phase 2. |
| Platform | Responsive React web now, RN later | One API both can share. |
| Backend | Supabase (Postgres + Auth + Storage + RLS) now; owner-run Node/Express + Postgres later | No hosting/ops now; clean migration because it's already Postgres. |
| Family model | Multiple families per user | Realistic for blended/extended families. |
| AI helper style | One-shot draft (conversational deferred) | One round-trip, cheap; human always reviews. |
| AI model | Cheap/small (Haiku-class) | Bounded extraction task; human edits after. |

## Architecture

- **Frontend:** React (responsive web / PWA-friendly).
- **Data/auth/storage:** Supabase. Row-Level Security enforces visibility at the
  database.
- **One server-side function:** Supabase Edge Function `extract-recipe`
  (`mode=text|url|image|audio`) — the only holder of a model API key. Takes raw
  input, returns structured recipe JSON matching the form schema.
- **Portability seam:** all data access goes through `lib/api/` (no
  `supabase.from()` in components). Migrating to Express+Postgres = reimplement
  that one folder; RLS rules get re-checked in backend code (normal anyway).

## Data model

- **profiles** — id (= auth user), display_name, avatar_url.
- **families** — id, name, created_by, invite_code.
- **family_members** — (family_id, user_id, role: `owner|member`). The M2M that
  allows belonging to several families.
- **recipes** — id, family_id, author_id, title, story, provenance, servings,
  prep_time, cook_time, visibility (`private|family|public`), source_url
  (nullable), created_at, updated_at. A recipe lives in exactly one family;
  wanting it in two is a fork (later).
- **recipe_ingredients** — (recipe_id, position, quantity, unit, item). Own rows
  so ingredient-search and scaling work.
- **recipe_steps** — (recipe_id, position, text). Own rows for Cook Mode +
  reordering.
- **recipe_photos** — (recipe_id, storage_path, is_cover). Includes handwritten-
  card scans.
- **comments** — (recipe_id, author_id, body, created_at). In-family comments.
- **tags** + **recipe_tags** — simple M2M.

### Access control (RLS)

A user may read a recipe if:
- `visibility = 'public'`, OR
- `visibility = 'family'` AND the user is a member of the recipe's `family_id`, OR
- `visibility = 'private'` AND the user is the author.

Write: author (and family owner) may edit/delete. Comments are readable by anyone
who can read the parent recipe, and writable by family members of that recipe.

## Create-recipe experience

One structured schema, one review/edit form, one save path. Two ways to fill it:

1. **Manual guided entry** — stepped: **ingredients first** (structured qty /
   unit / item lines), **then steps**, then metadata (title, times, servings,
   story, photo, tags, visibility).
2. **AI-assisted pre-fill** — provide input, `extract-recipe` returns a draft
   into the *same* form for review/edit before save. Front doors:
   - Paste text  /  Freeform write (same extractor, `mode=text`)
   - Paste URL (`mode=url`; try embedded JSON-LD `Recipe` schema first, AI as
     fallback — often zero model cost)
   - Photo of a card (`mode=image`, vision model)
   - Voice / dictation (`mode=audio`, transcribe then structure)

The AI never saves; it only pre-fills. Missing fields are left blank with a hint.

## Screens (web)

- Auth (sign in / up)
- Create / join family; family switcher
- Recipe list for active family (search by title/ingredient, tag filter)
- Recipe detail (photos, ingredients, steps, story, provenance, comments,
  visibility badge)
- Cook Mode (big-text steps, screen keep-awake)
- Add / Edit recipe (guided form + AI pre-fill panel)
- Profile / settings

## Invite flow

Each family has an `invite_code`. Owner shares `/join/<code>`; a signed-in user
who opens it is added to `family_members`. Owner can rotate the code. No email-
invite infrastructure in v1.

## Phase-2 seam (public feed)

The `visibility='public'` flag already exists, so the future feed is: query
public recipes across families + add follow / save / fork tables (fork copies a
recipe into your family with a link back to the original). No migration or
refactor to reach it.

## Deliberate simplifications (ponytail ledger)

- `extract-recipe` is one endpoint with a `mode` param, not four endpoints.
- Photo import in v1 = attach image; AI OCR arrives via `mode=image`, not a
  separate OCR pipeline.
- Freeform-write and paste-text share one extractor call.
- Tags kept as a plain M2M; no hierarchy/synonyms.
- No repository/ORM abstraction beyond grouping calls in `lib/api/`.

## Testing approach

- RLS policies: the highest-risk logic. Test that private/family/public reads and
  writes are allowed/denied correctly per membership.
- `extract-recipe`: assert it returns schema-valid JSON for each mode and leaves
  unknown fields blank rather than hallucinating.
- Core flows: create family, join via code, add recipe (manual + AI paths),
  comment visibility.
