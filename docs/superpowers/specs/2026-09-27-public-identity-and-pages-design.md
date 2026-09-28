# Public identity and public pages (Phase 2, sub-project 1)

Date: 2026-09-27
Status: designed, not built

## Why this exists

`visibility = 'public'` has shipped since v1 and, today, means less than it looks like it
means. Two facts drive this whole design, and both were found by reading the schema rather
than assumed:

1. **The public read surface already exists and is total.** `recipes_read` in
   `0003_recipes.sql` has no `to` clause, so it applies to the `anon` role, and
   `can_read_recipe` cascades that to ingredients, steps, photos, comments and tags. A public
   recipe is already fully readable by a signed-out stranger holding only the anon key.
2. **The page that read surface points at is unreachable.** `recipes/:id` lives inside
   `RequireAuth` (`src/routes.tsx`), and the Worker already injects per-recipe OpenGraph tags
   (`worker/meta.ts`). So a shared recipe link currently shows a correct preview to a crawler
   and a sign-in wall to the human who clicks it.

This sub-project closes that gap and gives a published recipe an author to be attributed to.

## Decomposition, and where this sits

"Follow, save, fork" is four subsystems, not one feature. Agreed split:

| # | Sub-project | Status |
|---|---|---|
| **1** | **Public identity + public pages** (this spec) | designed |
| 2 | Follow graph + feed | sketch below |
| 3 | Save + fork, with attribution and lineage | sketch below |
| 4 | Moderation: report, block, takedown | sketch below |

## Decisions taken

- **You follow a person, not a family.** Everything else in the codebase is family-scoped, but
  a solo cook's "family" is a wrapper that means nothing, and making them publish as one is
  wrong. The byline is the cook; the family name appears alongside it as secondary.
- **Public identity is an opt-in, and `handle` IS the opt-in.** Null means "I do not publish".
  No separate boolean, so the two can never disagree.
- **Comments never go public.** Enforced in SQL, not hidden in the UI.
- **Story, provenance and family name DO go public.** These are the point of the app.
- **One URL per recipe.** The signed-out page is the existing route with the existing
  component, degraded. Not a second implementation.

## Data model

One migration, `0020_public_identity.sql`.

```sql
-- Public identity. handle IS the opt-in: null means "I do not publish".
alter table profiles
  add column handle text unique
    check (handle is null or handle ~ '^[a-z0-9_]{3,30}$'),
  add column public_name text,
  add column bio text;
```

- **Handles are stored already-lowercased** and the check constraint enforces it, so
  case-insensitive uniqueness needs neither `citext` nor a functional index.
- **No reserved-word list.** Cook pages live under `/cooks/`, so a handle cannot collide with
  an app route. The namespace does the work a blocklist would. Impersonation handles
  (`admin`, `support`) are a moderation concern and belong to sub-project 4.
- **`public_name` and `display_name` stay separate.** `display_name` is what the family sees
  and must never leak.

### Public reads of otherwise-private tables

RLS is row-level and cannot hide `display_name` or `preferences` from a row it exposes. So a
public RLS policy on `profiles` is the wrong tool: it would hand anon the whole row. Column
narrowing is done with views instead, and `profiles` keeps having no policy for anon at all.

```sql
-- SECURITY DEFINER BY DEFAULT, AND DELIBERATELY SO. anon has no policy on profiles and must
-- not get one. This view is the ONLY public path into profiles, the explicit column list is
-- the gate, and `where handle is not null` is the row gate.
-- NEVER write select * here, and never add a column without deciding it is public.
create view public_cooks as
  select id, handle, public_name, bio from profiles where handle is not null;
grant select on public_cooks to anon, authenticated;
```

The byline needs the same treatment, because `families` is member-only too:

```sql
create view public_recipe_bylines as
  select r.id as recipe_id, p.handle, p.public_name, f.name as family_name
  from recipes r
  join families f on f.id = r.family_id
  left join profiles p on p.id = r.author_id and p.handle is not null
  where r.visibility = 'public';
grant select on public_recipe_bylines to anon, authenticated;
```

**The left join is deliberate.** A recipe can be public while its author has not claimed a
handle, and that must render as the family name alone rather than break the page. The UI will
require a handle before allowing publish, but the DB must not assume the UI is the only writer.

### Two existing-policy fixes ride along

Both are live RLS behaviour changes, so both get integration tests, and the first is run red
against the current policy before it is fixed.

```sql
-- was: for all using (can_read_recipe(...)), a READ predicate guarding WRITES. Any stranger
-- who could see a public recipe could insert or DELETE its tag rows. Harmless while nothing
-- is public; a real hole the moment this sub-project ships.
drop policy rtags_write on recipe_tags;
create policy rtags_write on recipe_tags for all
  using  (exists (select 1 from recipes r where r.id = recipe_id and is_family_member(r.family_id)))
  with check (exists (select 1 from recipes r where r.id = recipe_id and is_family_member(r.family_id)));
```

```sql
-- Comments must be readable on FAMILY or PRIVATE grounds, never on PUBLIC ones. Publishing a
-- recipe currently exposes the family's conversation about it, with no warning anywhere.
create function can_read_recipe_privately(rid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from recipes r where r.id = rid and (
    (r.visibility = 'family'  and is_family_member(r.family_id))
    or (r.visibility = 'private' and r.author_id = auth.uid())
    or (r.visibility = 'public'  and is_family_member(r.family_id))
  ));
$$;
drop policy comments_read on comments;
create policy comments_read on comments for select using (can_read_recipe_privately(recipe_id));
```

Note the third arm: a family member must keep reading comments on their own recipe after it is
published. Dropping public entirely would have taken the conversation away from the family too.

### Avatars

Avatars are served through a Worker route, `/avatar/:handle.jpg`, reusing the pattern
`worker/index.ts` already established for `/og/recipe/:id.jpg`: the bucket stays private, the
Worker signs server-side, and the address it hands out is stable and revocable.

A cheaper alternative was considered and explicitly rejected by Aayush: a storage policy
letting anon sign avatar URLs directly, which has identical privacy properties and costs one
line of SQL, but yields an hourly-changing URL that cannot be cached or used as a share
preview. The proxy was chosen so cook pages are share-ready from day one. Recorded here so the
trade is not relitigated: the cheap route remains available if the proxy ever proves annoying.

## Routes and the signed-out experience

- `recipes/:id` moves **outside** `RequireAuth`. Precedent exists: `/recover` and
  `/auth/callback` already sit outside it for their own stated reasons.
- `cooks/:handle` is new and public. **No `@` in the URL.** React Router v6 dynamic segments
  must be a whole path segment, so `@` would land inside the parameter and be stripped anyway.
- `/avatar/:handle.jpg` is a Worker route, not an app route.

`RecipeDetail` degrades when there is no session: title, story, provenance, ingredients, steps
and photos render; edit, cook mode and add-to-plan are **absent rather than disabled**.
Comments disappear via the RLS change. Tags need no code at all: `tags_read` is already
member-only, so a stranger reads no tag names and the row comes back empty. `AppLayout`'s nav
becomes a slim public header with a Sign in call to action.

Recipe photos need no new plumbing: `recipe_photos_read` is gated on `can_read_recipe`, so anon
can already sign a short-lived URL for a public recipe's photo.

## Error handling

Follows the rule `worker/index.ts` already set: **a private recipe and a missing one must be
indistinguishable**, or the status code itself leaks which is which. An unknown handle and an
unpublished cook both give the same 404.

## Testing

Integration tests first, since they now run in CI against real Postgres (`422c2e8`).

| Test | Proves |
|---|---|
| anon reads a public recipe's ingredients, steps and photos | the page can exist at all |
| anon gets **zero** comments on a public recipe | the `can_read_recipe_privately` gate |
| a family member still reads comments on their own published recipe | the third arm above |
| a non-member **cannot delete** `recipe_tags` on a public recipe | the hole is closed |
| anon reads `public_cooks`, gets nothing from `profiles` | `display_name`/`preferences` never leak |
| anon reads a byline but not `families` directly | the view is the only path |

**The `recipe_tags` test is run red against the current policy before the fix lands.** A test
nobody has seen fail is not evidence.

Unit tests: `RecipeDetail` rendering with no session, handle validation, and the Worker avatar
route following `worker/meta.test.ts`'s existing shape.

## Out of scope, and why

- **Follow, feed, save, fork, moderation.** Sub-projects 2 to 4.
- **Browse or search across all public recipes.** Needs the feed; nothing to browse yet.
- **A reserved-handle blocklist.** Routing does not need it; moderation might.
- **Cook page OpenGraph tags.** The avatar proxy makes them cheap later, but nothing links to a
  cook page until sub-project 2.

## Roadmap sketches

**2. Follow graph + feed.** A `follows(follower_id, cook_id)` table with the obvious RLS, a feed
query over public recipes by followed cooks, and browse/search across all public recipes.
`search_recipes` (`0010`) is SECURITY INVOKER and already respects RLS, so a public search may
be reachable by relaxing its caller rather than writing a second search.

**3. Save + fork.** Save copies a public recipe into your vault rather than pointing at it, so
that unpublishing cannot empty someone's vault. Fork is Save plus an edit, carrying lineage.
Both need attribution columns on `recipes` (`forked_from`, and a snapshot of the original
byline, because the original can be unpublished or renamed).

**4. Moderation.** Report a recipe, block a cook, a defined takedown path, and impersonation
handling for handles. Aayush also raised "propriety" for recipes, which reads two ways and was
deferred: ownership and attribution when someone copies a family recipe (sub-project 3), and
decency of what gets published (this one). Clarify before designing.

## Known landmine to fix if family catalog editing is ever revived

Unrelated to this spec but recorded in `HANDOVER.md`: three components keep only curated aisles
and would silently drop a family-invented one. Not a live bug, and not touched here.
