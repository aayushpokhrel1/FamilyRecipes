# Potluck: the feed, follows, and two hardening jobs (Phase 2, sub-project 2)

Date: 2026-09-27
Status: designed, not built
Follows: `docs/superpowers/specs/2026-09-27-public-identity-and-pages-design.md` (sub-project 1, SHIPPED and live)

## Why this exists

Sub-project 1 gave a published recipe a page and a cook an identity. Both are live. What it
did not give anyone is a way to FIND either: there is no link to a cook page anywhere in the
app, and no way to see what other households have published. Aayush hit this immediately,
having expected something beside Recipes and My Kitchen.

## The name

**Potluck.** A gathering where everyone brings a dish, which is exactly what the space holds:
recipes other families brought to share. It sits with Cupboard, Cook Mode and My Kitchen in
the app's register. "Discover" and "Feed" were rejected for sounding like every other product
rather than like this one.

## Decisions taken

### Signed in only, for now, and the asymmetry is the reason

`/potluck` sits inside `RequireAuth`. Individual recipe pages and cook pages stay public, as
shipped.

The two directions are not equally reversible. Signed in now, public later is one line in the
route table. Public now, signed in later does not un-cache what crawlers already took. Start
closed. The value being deferred is near zero today anyway: a browse index exists to be
discovered, and there is currently one published cook.

**This is a discovery brake, not a privacy boundary, and nobody should think otherwise.**
`recipes_read` grants `anon` on public rows, which is what makes the public recipe pages and
the OpenGraph previews work at all. Anyone with the publishable key out of the deployed bundle
can still list public recipes through the API. That was demonstrated, not assumed, during this
design session.

### The feed shows everything, with Following as a filter

A feed made only of "recipes from cooks you follow" would be empty for every user on day one.
So Potluck defaults to ALL public recipes, newest first, and Following narrows it. Following
with zero follows shows an empty state that names the fix, rather than silently falling back
to everything: a page that quietly changes meaning the first time you follow someone is
confusing exactly once and impossible to explain afterwards.

### Follows are private to the follower

Only you can see who you follow. There is no follower list and no follower count, anywhere.
One policy (`follower_id = auth.uid()`) and no denormalised counter to keep in sync. This can
be opened up later; it cannot easily be closed once people have seen numbers, and vanity
metrics are the wrong thing to grow into an app about family cooking.

## Data model

Migration `0023_follows.sql`:

```sql
create table follows (
  follower_id uuid not null references profiles(id) on delete cascade,
  cook_id     uuid not null references profiles(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (follower_id, cook_id),
  -- following yourself would put your own recipes into a feed meant for other people's
  constraint no_self_follow check (follower_id <> cook_id)
);
alter table follows enable row level security;

-- Private to the follower. No follower list, no count, so no other read path exists.
create policy follows_read on follows for select using (follower_id = auth.uid());

-- NOTE the write predicate is about WRITE rights, not readability. Guarding a write with a
-- read predicate is the bug 0003 shipped on recipe_tags and 0005 had to fix.
-- is_published_cook is the SECURITY DEFINER function from 0022, reused rather than inlined:
-- a subquery inside an RLS policy runs as the CALLER, so reading profiles inline would be
-- subject to profiles' own RLS and would be false for everyone. That mistake was made and
-- caught on the avatars policy in sub-project 1.
create policy follows_write on follows for all
  using (follower_id = auth.uid())
  with check (follower_id = auth.uid() and is_published_cook(cook_id));
```

`on delete cascade` on both sides: deleting an account removes it from everyone's following
list, which is correct and is stated here so it is not a surprise later.

## Queries, and what is deliberately NOT built

**No new view, and no server-side join.** Following is a filter over rows the caller can
already read:

- All: `recipes?visibility=eq.public&order=created_at.desc&limit=24`
- Following: read your own `follows` (RLS scopes it to you), then
  `recipes?author_id=in.(...)&visibility=eq.public`
- Bylines: one `public_recipe_bylines?recipe_id=in.(...)` for the visible page, never per card

**Search reuses `search_recipes` (`0010`) by making `p_family_id` nullable**, so public search
and family search share one matching rule and one set of trigram indexes. Writing a second
search is how the two drift apart, and this repo has twice paid to delete duplicated rules
(`groceryLabels.ts`, the shared aisle rule).

**The redefinition must keep the family branch behaviourally identical.** Migration `0009`
exists only because `0006` redefined an RPC with a fixed column list and silently dropped
`section`. The family path gets a regression test asserting it returns exactly what it does
today.

The tag filter stays family-only: tags are family-scoped and unreadable to a stranger, so a
public tag filter would filter on something the caller cannot see.

## UI

Nav order is `Recipes | My Kitchen | Potluck`: your vault, your planning, then other people's.

| Element | Behaviour |
|---|---|
| Scope toggle | `All` (default) / `Following`. Zero follows shows an empty state naming the fix. |
| Search | One box, calling the shared RPC with a null family id. |
| Grid | Reuses `RecipeCard`, not a second card component. |
| Pagination | Page size 24 with a "Show more" control, mirroring `PEEK_DAYS` in My Kitchen. |
| Follow | A Follow / Following toggle on `CookPage`, signed in only, never on your own page. |

### The reachability fix

A "View my public page" link in Settings' Public profile section once a handle exists, and
your own byline on a recipe links to `/cooks/:handle`.

**This is the cupboard bug's shape** (2026-09-24): built, correct, and unreachable on a real
account. A feature with no entry point does not exist. Worth asking of anything shipped: what
links to this?

## Hardening

### A. The error_log circuit breaker

`0018` left this explicitly as a ceiling: no rate limit, and `anon` may insert. The client caps
itself per page load, which bounds the honest case and not a hostile one. Unbounded
unauthenticated inserts grow until the project's disk or quota is the limit, at which point
writes fail and the table is useless to read.

**Prevention now, rather than after an incident.** Migration `0024_error_log_cap.sql`:

```sql
-- DROPS the row past the threshold rather than raising. A client reporting an error must
-- never be handed a second error, and monitoring being full is not the caller's problem.
create function error_log_cap() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from error_log where created_at > now() - interval '1 minute') >= 100 then
    return null;
  end if;
  return new;
end; $$;

create trigger error_log_rate_limit before insert on error_log
  for each row execute function error_log_cap();
```

Plus retention, so the table is bounded over time and not only per minute.

**The threshold is a knob, not a settled number.** 100 a minute is far above any honest rate
from this app's traffic and far below anything that grows the table dangerously.

### B. Read-volume bounds, and the residual risk that is ACCEPTED

Verify cloud `max_rows` matches local (1000), and paginate the feed (needed anyway).

**Scraping of public recipes is not preventable and is accepted.** Stated plainly so nobody
later believes a task closed it:

- The app's API calls go **direct to the Supabase host, not through the Cloudflare Worker**, so
  Cloudflare rate limiting never sees them. This is the fact that defeats the obvious mitigation.
- `max_rows` caps one response; a scraper paginates.
- The only true preventions are publishing less, or proxying every read through the Worker and
  revoking anon's direct grant, which would break the public recipe pages and OG previews that
  shipped in sub-project 1.

The real lever is the visibility flag on each recipe.

### What anon can and cannot do, measured

Established by probe against a database running these migrations, recorded so it is not
re-derived. Anonymous callers CANNOT: read a family or private recipe or its steps, read
comments on any recipe including public ones, read `profiles` or `families` directly, create
edit or delete any recipe, edit ingredients, delete steps, comment, delete tags, change a
display name, claim a handle, or rename a family. They CAN read a public recipe's title,
story, ingredients and steps, which is what public means, and insert an `error_log` row, which
is deliberate, cannot be attributed to another user, and cannot be read back.

## Testing

Integration, which now runs in CI against real Postgres:

| Test | Proves |
|---|---|
| you cannot read another person's follows | the private-follow policy |
| you cannot follow a cook with no handle | `is_published_cook` in the write check |
| you cannot follow yourself | `no_self_follow` |
| you cannot insert a follow as someone else | `follower_id = auth.uid()` |
| `search_recipes` with a null family id returns only public rows | the shared search |
| `search_recipes` with a family id returns exactly what it does today | the `0006` regression trap |
| inserts past the cap are dropped, the caller still succeeds, older rows survive | the circuit breaker |

Unit: the Following filter with zero follows, the search call shape, the follow toggle's two
states and its absence on your own page, and Potluck's loading, empty and populated states.

**The follow-policy tests are run red first.** A policy test nobody has seen fail is not
evidence, which this project relearned in sub-project 1 when a hole it had "found" turned out
to have been fixed a year earlier.

## Out of scope

- **Save and fork** with attribution and lineage: sub-project 3.
- **Moderation**, report, block, takedown, impersonation handling: sub-project 4. Aayush's
  "propriety" question still splits two ways (ownership when someone copies a family recipe,
  versus decency of what is published) and needs clarifying before that one is designed.
- **Follower counts and lists**, and any notification of being followed. Deliberate, see above.
- **Making Potluck public.** A later decision, and a one-line route change when taken.
- **Cook page OpenGraph tags.** The avatar proxy makes them cheap; nothing needs them yet.
