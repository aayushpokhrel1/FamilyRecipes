# Per-recipe OpenGraph previews

Follows the static card shipped in `cb68dec` (HANDOVER Next actions 6b, "the expensive half").
A crawler does not run the SPA, so a per-recipe preview needs the Worker to inject meta tags
for `/recipes/:id` before serving.

## Decisions (settled 2026-09-26, do not relitigate)

1. **Public recipes only.** The Worker is anonymous, so anything it injects is readable by
   anyone holding the link, whatever RLS says about the app. `private` and `family` recipes keep
   today's generic Enamel Vault card.
2. **The Worker holds NO secret.** It uses the publishable anon key, which already ships inside
   the JS bundle.
3. **The Worker proxies the image** at a stable `/og/recipe/:id.jpg`, rather than baking a
   long-lived signed URL into the tag. A baked URL is a bearer token that outlives a later
   change of visibility, so un-publishing a recipe would not revoke its image.
4. **No user-agent sniffing.** Inject for every `/recipes/:id` request. Sniffing is fragile and
   the alternative costs one fast edge-to-origin fetch on a page that already loads a 570 kB
   bundle.

## The load-bearing insight: RLS IS the visibility check

**Do not write a visibility check in the Worker.** Two policies already do it, for anonymous
callers, and they are the same predicate the app trusts:

- `recipes_read` (`0003_recipes.sql`): `visibility = 'public' or (family and is_family_member)
  or (private and author_id = auth.uid())`. **No `to authenticated` clause**, so it applies to
  the `anon` role, where `auth.uid()` is null and only the `public` arm can be true.
- `recipe_photos_read` on `storage.objects` (`0004_storage.sql`): gated on `can_read_recipe`,
  which resolves the same way.

So an anon-key read returning a row **is** the proof that a recipe is public. A second check in
Worker code would be a second source of truth that can drift from the first. If the anon read
returns nothing, serve the generic card and a 404 image. That is the whole security model, and
it fails closed.

## Tasks

### Task 0 (BLOCKING, Aayush + verification): prove the anon path works

Everything rests on the claim above and it is currently **unverified**, because the database
contains no public recipe. `select` as anon returned `[]`, which is consistent with the claim
but does not prove it.

- Mark ONE recipe `public` temporarily (Aayush, in the app).
- Verify, with the publishable key and no auth header:
  - `GET /rest/v1/recipes?id=eq.<id>&select=id,title,story` returns the row
  - `GET /rest/v1/recipe_photos?recipe_id=eq.<id>&select=storage_path,is_cover` returns rows
  - `POST /storage/v1/object/sign/recipe-photos/<path>` returns a signed URL
  - the SAME calls for a `family` recipe return empty / refuse
- **If signing as anon fails, stop and re-plan the image half.** The metadata half still stands.

### Task 1: Worker scaffold, behaviour-preserving

`wrangler.jsonc` is assets-only today (no `main`). Add a Worker script that passes everything
through, so the risky change lands separately from the feature.

- `worker/index.ts`, `main` in `wrangler.jsonc`, `assets.binding: "ASSETS"`.
- Default branch: `return env.ASSETS.fetch(request)`.
- Env: `SUPABASE_URL`, `SUPABASE_ANON_KEY` as **plain vars, not secrets** (the anon key is
  already public). They must be set in the Cloudflare build config, which is the same place the
  `VITE_*` pair lives; **see the HANDOVER warning about reconnecting the repo wiping that config.**
- Verify: the site still serves, and `/kitchen/cupboard` still deep-links (SPA fallback intact).

### Task 2: pure helpers, with tests

Keep the logic out of the Worker shell so it is testable without a Worker runtime.

- `worker/meta.ts`:
  - `recipeIdFromPath(pathname): string | null` — matches `/recipes/:uuid`, and **must not**
    match `/recipes/:id/edit` or `/recipes/:id/cook`, which are app-only routes.
  - `ogIdFromPath(pathname): string | null` — matches `/og/recipe/:uuid.jpg`.
  - `buildTags({ title, story, id, hasPhoto, origin })` — returns the tag values. Escapes `&`,
    `<`, `>`, `"` in every injected value. Truncates description to ~160 chars on a word
    boundary. Falls back to the static card when `hasPhoto` is false.
- Unit tests for each, including the edit/cook non-match and the escaping.

### Task 3: inject the tags

- In the Worker, on a `/recipes/:id` match: fetch the row with the anon key, fetch the asset,
  and rewrite with **`HTMLRewriter`** (do not string-replace HTML).
- Rewrite `og:title`, `og:description`, `og:url`, `og:image`, `og:image:alt`, and `<title>`.
- **No row, or any fetch failure, means serve the asset untouched.** The static card is the
  correct degradation, and a recipe page must never fail to load because a preview could not be
  built.
- Verify with `curl` against the deployed URL, since a crawler is just a plain GET.

### Task 4: the image route

- `/og/recipe/:id.jpg`: anon-read the cover photo (`is_cover`, else the first), sign it, fetch
  it, stream it back.
- 404 when the recipe is not public or has no photo.
- `Cache-Control: public, max-age=3600`.
- **Stream, do not redirect** to the signed URL: keeps the URL stable and does not hand a bearer
  URL to the caller.

### Task 5: end-to-end

- Public recipe: paste its URL into WhatsApp or iMessage, confirm title and photo.
- **Family recipe: confirm it shows the GENERIC card and nothing of its own.** This is the test
  that matters; the rest is polish.
- Un-publish the task 0 recipe afterwards and confirm the preview reverts to generic.

## Out of scope

- Caching the metadata fetch (add only if a recipe page measurably slows).
- Per-recipe previews for `family` recipes behind a signed share link. A different feature.
- Twitter-specific tags: Twitter falls back to `og:`.
