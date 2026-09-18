# Family Recipes

A private, multi-family recipe vault. Families collect, organize, and pass down
their recipes with photos, story, and provenance. Each recipe carries a
visibility flag (Private / Family / Public) so an opt-in public recipe feed can
grow on top later. A community of food lovers, built family-first.

## Status

Pre-implementation. The v1 design is approved and lives in
[docs/superpowers/specs/2026-09-16-family-recipes-design.md](docs/superpowers/specs/2026-09-16-family-recipes-design.md).

## What v1 does

- **Multiple families per user** — belong to several, switch between them.
- **Rich recipes** — ingredients, steps, servings, times, tags, photos, plus a
  story and provenance ("from Grandma, adapted by Mom").
- **Easy entry** — a guided manual form, or AI pre-fill from pasted text, a URL,
  a photo of a handwritten card, voice, or freeform writing. The AI drafts; you
  always review before saving.
- **Per-recipe visibility** — Private / Family / Public.
- **In-family comments** and **Cook Mode** (big-text, screen stays awake).

## Stack

- React (responsive web now; React Native app later, sharing the same API).
- Supabase — Postgres, Auth, Storage, and Row-Level Security enforcing the
  visibility model.
- One Supabase Edge Function (`extract-recipe`) for AI recipe structuring.

Designed for portability: all data access is isolated in `lib/api/`, so moving
to a self-owned Node/Express + Postgres backend later is a bounded swap.

## Roadmap

- **v1** — private multi-family vault (this design). Built and live.
- **My Kitchen** — personal meal planning + auto grocery list from picked
  recipes; plans shareable read-only with the family.
  [Design](docs/superpowers/specs/2026-09-18-my-kitchen-meal-planning-design.md).
- **Phase 2** — public recipe-only community feed: follow, save, fork with
  link-back. The `public` flag already ships in v1.
- **Later** — smart ingredient normalization for grocery lists (synonym /
  LLM canonicalization so "all-purpose flour" == "flour", plus unit-aware
  quantity merging), native app.
