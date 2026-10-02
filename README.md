# Family Recipes

A private, multi-family recipe vault. Families collect, organize, and pass down their recipes
with photos, story, and provenance. Each recipe carries a visibility flag (Private / Family /
Public) so an opt-in public recipe feed can grow on top later. A community of food lovers, built
family-first.

**Live at <https://recipes.enamelvault.com>.**

## Documentation

| Document | What it holds |
| --- | --- |
| `PRODUCT.md` | Who it is for, the product decisions, the roadmap, and what is deliberately deferred. Not in this repo: it is gitignored, because the roadmap is not something a public repository needs to publish |
| [DESIGN.md](DESIGN.md) | The Enamel Vault design system: tokens, type, colour, components |
| [docs/OPERATIONS.md](docs/OPERATIONS.md) | Running it locally, verifying, CI, deploying, secrets, monitoring, environment traps |
| [docs/superpowers/specs/](docs/superpowers/specs/) | Per-feature design specs, newest first |

`HANDOVER.md` is local-only and gitignored: it holds current session state, nothing durable.

Engineering lessons are **not** kept in this repo as prose. A rule about specific code lives as a
comment at that code, where it cannot be missed; the generalisable half lives in the Obsidian
vault (`Projects/FamilyRecipes/`), which spans every project. See `CLAUDE.md`.

## What it does

- **Multiple families per user**: belong to several, switch between them.
- **Rich recipes**: ingredients, steps, servings, times, tags, photos, plus a story and
  provenance ("from Grandma, adapted by Mom").
- **Easy entry**: a guided manual form, or AI pre-fill from pasted text, a URL, a photo of a
  handwritten card, voice, or freeform writing. The AI drafts; you always review before saving.
- **Optional ingredients and alternatives**: mark something optional, or as a swap for another
  ingredient. The grocery list buys one of a swap pair, never both.
- **Per-recipe visibility**: Private / Family / Public.
- **Drafts**: save an unfinished recipe and come back to it, including one the AI pre-filled.
  A draft belongs to its author alone and is never a row in `recipes`. A pending edit to an
  already-published recipe is a draft too: the recipe stays untouched until you publish, and if
  someone else changed it meanwhile you are told and asked, rather than silently overwriting.
- **In-family comments** and **Cook Mode** (big-text, screen stays awake).
- **Potluck**: a signed-in space for other households' public recipes, with search, a public
  cook page per handle, and following. Saving a copy into your own vault keeps the original
  cook's attribution, and the copy survives the original being unpublished or deleted.
- **My Kitchen**: meal planning on a day-by-slot week grid (drag a meal's grip, or tap to
  assign), leftovers that fill a slot without buying twice, and a grocery list built from the
  plan, grouped by supermarket aisle and scaled to each plan item's servings.
- **The cupboard**: what you already have, so the grocery list stops telling you to buy it.
- **Sign-in** with a verified email address or with Google.
- **Moderator console** at `/moderation`: the report queue, an overview of site counts, and a
  roster with suspend, take down, grant moderator and delete. Visible only to a moderator, and
  the page re-checks that rather than relying on the nav hiding the link.
- **Public documents**, readable without an account: terms, privacy policy, cookies, and help
  (`/terms`, `/privacy`, `/cookies`, `/help`). There is no cookie banner because the app sets
  no cookies and loads no analytics, which a test enforces rather than a promise.

## Stack

- React (responsive web now; a React Native app later, sharing the same API).
- Supabase: Postgres, Auth, Storage, and Row-Level Security enforcing the visibility model.
- Four Supabase Edge Functions: `extract-recipe` (AI recipe structuring), `delete-account`,
  `notify-report` (emails the moderation queue through Resend), and `admin` (the moderator
  console's backend, which needs the service-role key and so cannot live in the browser).
- Cloudflare Workers serves the built frontend and, because a crawler never runs the SPA,
  everything a crawler has to see in the HTML: per-recipe OpenGraph tags and canonical URLs,
  proxied preview images and avatars, JSON-LD recipe data, `/sitemap.xml`, and a health route.

Designed for portability: **all data access is isolated in `src/lib/api/`**, and nothing outside
it imports the Supabase client, so moving to a self-owned Node/Express + Postgres backend later
is a bounded swap.

## Quick start

Docker must be running.

```bash
npx supabase start
```

```bash
npm run dev
```

Full setup, environment variables and the verify commands are in
[docs/OPERATIONS.md](docs/OPERATIONS.md).

## Roadmap

Shipped, newest first: the public documents and the WCAG AA contrast and labelling fixes ·
search-engine indexing (robots, sitemap, canonical, JSON-LD) · moderation, reporting and
takedown · save and fork with attribution · Potluck, the public feed (browse, search, follow) · public identity and
public cook pages · optional ingredients and alternatives · week-grid drag and drop · error
and uptime monitoring · verified email and Google sign-in · the cupboard and "cook now" ·
ingredient aisles · My Kitchen week grid · recipe enrichment and grocery scaling · My Kitchen
meal planning · v1 private multi-family vault.

Next: opening Potluck beyond signed-in users, which moderation and the public documents now
unblock.

Later: LLM / entity canonicalization for ingredients, a family-editable ingredient catalog,
and a native app. Per-recipe link previews are already built, in the Worker.

`PRODUCT.md` has the detail, including what is deferred and why. It is deliberately not published here.
