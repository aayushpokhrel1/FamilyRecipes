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

**Growing (Phase 2, part shipped): the food-lover community.** Individuals who
discover, follow, save, and fork public recipes through an opt-in public feed. Browsing,
searching and following shipped as **Potluck**; save and fork are designed, not built.
Potluck is signed in only for now.

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
- **Weekly planning:** My Kitchen opens on what is being cooked today and over the next few
  days, merged across every plan the member can read (their own, plus plans shared with them).
  A dated plan is editable as a week grid of days by meal slots, and can be duplicated onto the
  following week. The auto grocery list is grouped by normalized ingredient, de-duplicated
  across recipes, checkable, and takes manual lines; plans are shareable read-only with the family.
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
- My Kitchen: personal meal plans (open-ended, or dated and shown as a week grid), a today and
  up-next landing merged across readable plans, week duplication, an auto grocery list, and
  plans shareable read-only with family.
- Leftovers: one cook event can fill several slots. A leftover slot points at its source item,
  renders in its own slot, and contributes NOTHING to the grocery list, so a pot is bought once.
  Marking a leftover offers to raise the source's servings; it never changes them on its own.
- Pantry staples: ingredients a family always keeps in are recorded per family and their grocery
  lines are moved into a separate "check you have these" group. They are FLAGGED, never hidden,
  because silently dropping a line would hide a real shortage.

- Ingredient aisles: which aisle an ingredient belongs to is DERIVED from its name against a
  curated catalog of about 115 items, never stored on the recipe, because it is a fact about the
  ingredient rather than about the recipe. The grocery list groups by aisle by default; the recipe
  page offers it as a view toggle that defaults to the author's own order. Anything the catalog
  does not recognise groups under "Other", and a family can tag it once (stored per family, and it
  may override the catalog as well as extend it), after which both views agree.
- Ingredient sections are a separate concept from aisles: a section is a part of a recipe ("For
  the marinade") and is the cook's judgement, so it is never auto-filled. The editor offers the
  sections used in that recipe, then the family's own past sections, then a short curated list.

- **A public identity for a cook**, opt in. A `handle` is the opt-in itself: null means "I do not
  publish", so there is no second flag that can disagree with it. A published cook gets a page at
  `/cooks/:handle` showing their public name, bio and published recipes, readable signed out.
- **A published recipe is readable signed out**, at the same URL it has signed in, with the cook
  and family as a byline. What a stranger sees is deliberate: title, ingredients, steps, photos,
  story and provenance yes; **comments never**, on any recipe, published or not.
- **Potluck**, at `/potluck`: browse and search every public recipe, narrowable to the cooks you
  follow. **Signed in only for now.** Following is private to the follower, so there is no
  follower list and no follower count anywhere.

Explicitly undecided or deferred (future work must not present these as done):

- **The visual pass on the new surfaces is deliberately LAST.** Potluck and the cook page work
  and are documented, but they are not yet dressed in the Enamel Vault world: the byline is
  plain text rather than a maker's mark, the scope toggle is two generic buttons, and the cook
  page is a plate with a bulleted list. This is a sequencing decision made on 2026-09-28, not an
  oversight: design lands after the features are built, so the pass is done once against a
  finished surface instead of repeatedly against a moving one. Do not re-propose it as the next
  piece of work; the ideas are in this session's brainstorm and in `DESIGN.md`.

- The **public feed is now PART built.** Browsing, searching and following shipped as Potluck,
  and **save with attribution and lineage is BUILT** (2026-09-28): a save copies a recipe into
  your vault rather than pointing at it, so unpublishing cannot empty someone else's vault.
  A copy **cannot be published**, held by one check constraint, because moderation does not
  exist yet; dropping that constraint is the whole change when it does. The credit line is
  permanent and goes quiet once you have edited the copy. Photos do not travel.
- **Moderation: the spine is BUILT** (2026-09-29, sub-project 4a). A signed-in cook can report
  a public recipe; the moderator reviews at `/moderation` and can unpublish, suspend the cook,
  or dismiss; the author is told on their own recipe why it came down, and cannot re-publish it.
  A takedown leaves already-saved copies alone, which is sub-project 3's promise. Terms are at
  `/terms` behind a gate that sits after authentication, so Google sign-in and existing accounts
  are caught too.
- **Personal controls and the impersonation remedy are BUILT** (2026-09-29, sub-project 4b)
  and DEPLOYED, though not yet verified on production. You can mute a cook (their recipes leave your Potluck, one way) or
  block one (it cuts both ways and severs any follow), from their cook page, and lift either
  from Settings. A report can now name a COOK as well as a recipe, and a moderator can clear
  an impersonating public name; the handle is deliberately kept, because it is the identity in
  every `/cooks/<handle>` URL. The cook is told in Settings that the name was cleared and why.
  The copy says a blocked cook "will not see" your recipes, never "cannot see": public rows
  stay readable to anyone signed out, and a test pins that wording.
  **Still missing, and deliberate:** nothing tells a cook they were blocked, ever. You cannot
  block a whole family. There is no appeal path and no audit log of moderator actions. Aayush
  is the only moderator and the flag is set by hand.
- **Every cook always has at least one kitchen, and one of them is theirs** (decided
  2026-09-30, **BUILT 2026-10-01** in migration 0032, verified in a browser on a fresh
  account). Signup creates a profile and NO family, but `recipes.family_id`
  is `not null` and ten pages key off the active family, so a brand-new account cannot save a
  recipe, use My Kitchen, the Cupboard, meal plans, grocery or cook mode. The fix is an
  invariant rather than a special row: an idempotent `ensure_own_kitchen()` that creates a
  family plus an owner membership only when the cook has zero memberships. No `is_personal`
  column, deliberately: a marker would drag in rules about whether you can invite to it, leave
  it or delete it, and as a plain family the answer to all three is "same as any other". It
  also self-heals, so a cook who leaves every family gets a kitchen back instead of falling
  into the dead-button state.
  **Why not avoid the spare kitchen for people who join a relative's family:** considered, and
  rejected as machinery that prevents an outcome which is arguably correct. A cook who joins
  their mother's family legitimately has two kitchens, theirs and hers, and a personal kitchen
  is what makes the app usable for a solo cook who only wants the vault and the public feed.
  **Naming matters publicly:** `public_recipe_bylines` publishes `family_name`, so the kitchen
  name appears under every recipe published from it. `display_name` defaults to `'Cook'`, so
  the fallback must be "My kitchen" rather than "Cook's kitchen".

- **A draft belongs to its AUTHOR and carries a destination; it is not a row in `recipes`**
  (decided 2026-09-30, **5a BUILT 2026-10-01**: see
  `docs/superpowers/specs/2026-10-01-drafts-design.md`. 5b, a pending edit to a live recipe,
  is **BUILT 2026-10-01**: see docs/superpowers/specs/2026-10-01-pending-edits-design.md). A draft must have a title, decided 2026-10-01. Drafts are personal, so they
  key to `author_id` and only the author can read them. They are NOT stored in the cook's
  personal kitchen: a pending edit to a recipe that lives in a SHARED family would then be
  filed in a different family from the recipe it edits, and "which family owns this draft"
  would have two defensible answers, which is how a rule ends up enforced in one query path and
  not another. Instead a draft carries `target_family_id` (where it lands when finished,
  defaulting to the personal kitchen) and `target_recipe_id` (for a pending edit, which pins
  the family implicitly). Keeping drafts out of `recipes` also avoids teaching all 11 queries
  against that table, plus `search_recipes`, to exclude them.

- **`/terms` is a deliberately short first draft, and seven things are missing from it.** Short
  is the decision, a document nobody reads is worse than a short one people might, but short and
  incomplete are different. Missing, roughly in order of how much they matter: a **food safety
  and liability** disclaimer, which is the one clause a recipe app specifically needs since
  recipes come from other cooks unchecked and allergens may be unlisted; a **privacy notice**,
  probably its own `/privacy` page, because the app stores emails, display names, avatars,
  Google sign-in identities, uploaded photos and a runtime `error_log`, processed by Supabase,
  Cloudflare and Google, and the terms mention none of it; **who operates it** and under which
  jurisdiction; a **minimum age**; a line saying **the terms can change**, which the code
  already enforces through `TERMS_VERSION` but the page never states; and a **photo licence**
  line, since uploads are accepted. The contact address is covered in `HANDOVER.md`.

- **Potluck is signed in only, and that is a discovery brake rather than a privacy boundary.**
  Public rows stay readable to the anon role through the API, which is what makes the public
  recipe pages and the link previews work at all. Opening Potluck up later is a one-line route
  change; what cannot be undone is what crawlers cache once it is open, which is why it starts
  closed.
- **Follower counts, follower lists and any notification of being followed** are deliberately
  absent. One RLS policy instead of a denormalised counter, and no vanity metric in an app about
  family cooking. Easy to add later; hard to remove once people have seen numbers.
- A **family-editable ingredient catalog** is not built. A family can tag an ingredient's aisle,
  which is enough to empty the "Other" group over time, but they cannot add, rename or remove
  catalog entries or invent an aisle from the UI.
  **The aisle tag is also in the wrong places** (raised 2026-09-29). `setCategoryOverride` is
  reachable from the grocery list (`GroceryPanel`) and from Settings (`FamilyDataPanel`), but
  NOT from the recipe ingredient editor and NOT from the Cupboard, which are the two screens
  where you actually notice something has landed in "Other". The capability exists; the
  affordance is missing from the places that would use it. Needs a design pass, not a feature.

- **The Cupboard has no "Add from list"** (raised 2026-09-29). `IngredientEditor` has a picker
  behind an "Add from list" button; the Cupboard makes you type every staple by hand. The same
  picker should serve both, which is a component-extraction question rather than new logic.

- **Cook Mode wants a rethink** (raised 2026-09-29, Aayush). It works but it is a plain list.
  Ideas he floated: hovering an ingredient shows its scaled proportion; the recipe stays
  visible on the side rather than scrolling away. This is a design brainstorm, not a ticket:
  the question is what a person actually needs while their hands are busy, and the answer may
  be neither of those. Do not build it from this paragraph.
- **Ingredient normalization** for grocery lists now adds a curated synonym map on top of the
  cheap key-based grouping, so "all-purpose flour" and "flour" become one line. **LLM / entity
  canonicalization is still deferred** and remains the unbuilt half: anything the map has never
  seen stays a separate line. `normalizeItem` is the seam it will slot into.
- **Unit-aware quantity merging** is built, but only WITHIN a unit family, and metric and
  imperial are separate families. So 2 tbsp + 1/4 cup merges to 6 tbsp, while 1 cup + 500 g,
  or cups + millilitres, deliberately do not. Cross-system conversion is out of scope, and
  volume-to-weight needs per-ingredient density that does not exist here.
- **Per-recipe link previews** are half built. `index.html` carries site-wide OpenGraph tags, and
  a public recipe gets its own title and photo via the Worker. Previews for `family` recipes
  behind a share link are deliberately not built.
- **Sorting tags by how often the family uses them** is deferred. The picker caps its height and
  filters above 12 tags, which solves crowding; ordering by use would solve *hunting*, but needs
  usage counts. Worth doing only if the filter proves insufficient in real use.
- **Citing a cookbook is an idea, not a design yet, and needs a brainstorm before it is built.**
  Noticed 2026-09-28: the only published recipe carried `Smoky BBQ Sauce (page 341)` inside an
  ingredient, and `displayItem()` now strips it, because the rule that removes a leaked quantity
  drops any parenthetical containing a digit. That is the right call for `(1.5 kg)` and the wrong
  one for a page reference, which is provenance a family would want kept. The recipe already has
  a `provenance` field and a `source_url`, so the open questions are whether a cookbook is a
  first-class thing (title, author, edition, page) or just richer free text, whether a page
  reference belongs on the recipe or on the individual ingredient that points at another recipe,
  and whether "page 341" should one day LINK to that other recipe once it is in the vault. Do not
  build it from this paragraph.

- A **React Native app** is planned later, sharing the same API. It does not exist yet.
- **Email confirmation is ON** (since 2026-09-26), delivered through Resend on
  `mail.enamelvault.com`, and Google sign-in is live alongside it. This line previously said
  confirmation was off for pre-real-user testing; that has not been true since that date.

## Brand Commitments

- **Name:** Family Recipes.
- **Voice (from existing copy):** warm, plain, and family-first. "A community of food
  lovers, built family-first"; provenance framed in human terms like "from Grandma,
  adapted by Mom." Not clinical, not hype.
- **Trust commitment:** AI is always a draft the human reviews, never an auto-save. This
  is a product promise, not just an implementation detail.

## Evidence on Hand

- Live, deployed product at https://recipes.enamelvault.com (Cloudflare Workers). The old
  workers.dev hostname is not the canonical address and must not be cited as one.
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

- **The target is WCAG 2.2 AA**, and this is now a binding commitment rather than an
  aspiration, because `/help` states it in public. It was previously recorded here as "no
  formal conformance level established"; that is no longer true and the page is the reason.
- **Cook Mode** is an explicit usability feature: large text and a wake lock for
  hands-busy, at-a-distance reading while cooking.
- Responsive web across phone and desktop is a baseline expectation.
- Three things hold the AA claim up mechanically, rather than by intention:
  `src/index.contrast.test.ts` measures every rendered colour pair against the real tokens,
  `src/lib/accessibility.test.ts` scans the source for missing alt text, unlabelled form
  controls and click handlers a keyboard cannot reach, and
  `src/lib/browserStorage.test.ts` holds the no-cookie-banner claim to the actual storage.
- **Not yet done, and known:** no screen reader has been run over the app by a human, no
  audit by anyone outside the project, and recipe photos have no author-supplied alt text
  because there is no field to put one in. See the compliance section below.

## Legal, privacy and compliance

The public documents exist and are routed outside the auth guard, because a notice you can
only read after consenting is not a notice: `/terms`, `/privacy`, `/cookies`, `/help`.

What the current position actually rests on:

- **No cookies, no analytics, no advertising, no third-party embeds, and no third-party
  requests of any kind.** The typeface is self-hosted, so loading a page contacts nobody but
  us. That is why there is no consent banner. It is a fact about the code, not a policy
  choice, and `src/lib/browserStorage.test.ts` is what keeps it a fact.
- **Nothing is sold.** No payments, no card details, no subscription, so the refund position
  in the terms is simply that there is nothing to refund.
- **No testimonials, reviews, customer names, usage benchmarks or pricing exist anywhere in
  the product**, and none were invented to fill the new pages. Future work must not fabricate
  any of these.
- **The controller is a named individual**, contactable by email, which is the minimum UK and
  EU law requires. There is no company and the pages say so.

### Deferred, with the reason

- **A data export button.** The privacy policy promises a copy of your data on request, and
  that promise is currently kept by hand over email. A one-click export in Settings would
  turn a manual obligation into a feature, and the delete-account function already proves the
  shape.
- **Author-supplied alt text for recipe photos.** Today `/recipes/:id` falls back to
  "Photo of <title>", which is honest but says nothing about the picture. A caption field on
  upload would fix the accessibility gap and improve the public pages at the same time.
- **A real accessibility audit**, including an actual screen reader pass. The automated
  checks catch the mistakes made while typing, which is most of them, and none of the ones
  that only show up when you try to use the thing without a mouse.
- **Reconsider the AI import's data path.** Recipe text, photos and voice clips go to
  DeepSeek and Groq, which is disclosed, but it is the only place user content leaves our
  infrastructure. Options worth weighing: a provider inside the UK or EU, an explicit
  per-use confirmation rather than the current implicit one, or a self-hosted model.
- **A DPA and a retention schedule.** Processor agreements are not in place as signed
  documents, and "error reports are cleared out as they age" is currently true by intention
  rather than by a scheduled job.
- **Cookie consent, the day it becomes necessary.** Adding analytics, an embed, or any
  non-essential storage makes a banner mandatory, not optional. The storage test is wired to
  go red at exactly that moment, and `src/pages/Cookies.tsx` carries the warning at the top.
