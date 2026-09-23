# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

**Primary (now): everyday home cooks inside a family.** People who belong to one or
more families and open the app to decide what to cook, follow a recipe hands-free
(Cook Mode), plan the week and shop from an auto-generated grocery list (My Kitchen).
The same person is often the **family recipe-keeper**, capturing and curating the
family's recipes with their photos, story, and provenance.

**Growing (planned, Phase 2): the food-lover community.** Individuals who will
discover, follow, save, and fork public recipes through an opt-in public feed. The
`Public` visibility flag already ships; the feed itself is designed, not built.

The product is family-first today and community-later by intent: private family use is
the center, public sharing is additive.

## Product Purpose

A private, multi-family recipe vault where families store, organize, and pass down
recipes with photos, story, and provenance. A per-recipe visibility model
(Private / Family / Public) lets a private vault grow an opt-in public recipe feed
later without re-architecting.

Success is not one metric: the user confirmed all four of these outcomes matter and
future design should protect each of them, not trade one for another.

- **Preservation & provenance:** family recipes stay safe with their story and lineage intact.
- **Everyday cooking utility:** it is genuinely easier to decide, cook, plan, and shop.
- **Family connection:** sharing, commenting, and cooking each other's recipes.
- **Effortless capture:** getting a recipe in is low-friction enough that nothing is left uncaptured.

## Positioning

- **Family-first, multi-family membership.** One user belongs to several families and
  switches between them, rather than a single personal cookbook or a single shared account.
- **Story and provenance are first-class.** Recipes carry narrative and lineage
  ("from Grandma, adapted by Mom"), not just ingredients and steps.
- **A visibility model that seeds a community.** Private / Family / Public is enforced by
  row-level security, so the same private vault can grow an opt-in public feed later.
- **AI-assisted, human-reviewed capture.** Pre-fill a recipe from pasted text, a URL, a
  photo of a handwritten card, or voice. The AI always drafts and the person always
  reviews before anything is saved.

## Operating Context

- **In the kitchen while cooking:** Cook Mode (large text, screen kept awake) for hands-busy use.
- **Weekly planning:** My Kitchen personal meal plans (list and calendar views) with an
  auto grocery list, grouped by normalized ingredient and de-duplicated across recipes,
  checkable, plus manual lines; plans are shareable read-only with the family.
- **Capture:** entering recipes from cards, links, photos, or voice, then reviewing the draft.
- **Family collaboration:** in-family comments on recipes.
- Data lives in Supabase (Postgres, Auth, Storage, RLS). All data access is isolated in
  `src/lib/api/` as a portability seam for a possible future Node/Express + Postgres backend.

## Capabilities and Constraints

- Multiple families per user; switch between them; join a family by code.
- Rich recipes: ingredients, steps, servings, times, tags, photos, story, provenance.
- Four AI extraction modes (text, URL, photo, voice) via one Supabase Edge Function
  (`extract-recipe`). The AI produces a draft the user reviews before saving.
- Per-recipe visibility Private / Family / Public, enforced by RLS.
- In-family comments and Cook Mode.
- My Kitchen: personal meal plans, auto grocery list, plans shareable read-only with family.

Explicitly undecided or deferred (future work must not present these as done):

- The **public community feed** (follow / save / fork with link-back) is designed, not built.
- **Ingredient normalization** for grocery lists now adds a curated synonym map on top of the
  cheap key-based grouping, so "all-purpose flour" and "flour" become one line. **LLM / entity
  canonicalization is still deferred** and remains the unbuilt half: anything the map has never
  seen stays a separate line. `normalizeItem` is the seam it will slot into.
- **Unit-aware quantity merging** is built, but only WITHIN a unit family, and metric and
  imperial are separate families. So 2 tbsp + 1/4 cup merges to 6 tbsp, while 1 cup + 500 g,
  or cups + millilitres, deliberately do not. Cross-system conversion is out of scope, and
  volume-to-weight needs per-ingredient density that does not exist here.
- A **React Native app** is planned later, sharing the same API. It does not exist yet.
- Email confirmation is currently off for pre-real-user testing.

## Brand Commitments

- **Name:** Family Recipes.
- **Voice (from existing copy):** warm, plain, and family-first. "A community of food
  lovers, built family-first"; provenance framed in human terms like "from Grandma,
  adapted by Mom." Not clinical, not hype.
- **Trust commitment:** AI is always a draft the human reviews, never an auto-save. This
  is a product promise, not just an implementation detail.

## Evidence on Hand

- Live, deployed product at https://familyrecipes.aayus-pok.workers.dev (Cloudflare Workers).
- Public repository: https://github.com/aayushpokhrel1/FamilyRecipes.
- Approved design specs in `docs/superpowers/specs/` (v1 vault, and My Kitchen meal planning).
- Unit and integration test suites, including RLS visibility-boundary tests.
- No testimonials, customer names, usage benchmarks, or pricing exist. Future work must
  not fabricate any of these.

## Product Principles

1. **Family-first, community-later.** Every surface serves the private family vault first;
   public sharing is opt-in and additive, never the default.
2. **Preserve the story, not just the recipe.** Provenance, photos, and narrative are
   first-class, not afterthought metadata.
3. **AI drafts, humans decide.** Capture is effortless, but the person always reviews
   before anything is saved.
4. **Earn a place in the kitchen.** Cooking and planning (Cook Mode, meal plans, grocery
   lists) must work in real, hands-busy kitchen conditions.
5. **Portable by construction.** Data access stays behind `src/lib/api/` so the product
   can outlive its current backend.

## Accessibility & Inclusion

- **Cook Mode** is an explicit usability feature: large text and a wake lock for
  hands-busy, at-a-distance reading while cooking.
- Responsive web across phone and desktop is a baseline expectation.
- No formal WCAG conformance level has been established as a binding requirement.
