# Telling a cook what happened, and letting them argue back (Phase 2, sub-project 4c)

Date: 2026-10-02
Status: SPEC, not built
Follows: `docs/superpowers/specs/2026-09-28-moderation-spine-design.md` (4a) and
`docs/superpowers/specs/2026-09-29-block-mute-and-handles-design.md` (4b), both SHIPPED

## Why this exists

4b built the name-clear remedy and it works: verified on production 2026-10-02, the cleared
cook sees a notice in Settings, keeps their handle and keeps their page.

Two things are wrong with where that left them.

**They are told in the one place they have no reason to visit.** The notice sits in Settings.
Nothing on any other page says anything, so a cook can carry on for weeks not knowing.

**Their recipes keep publishing under "A cook".** With `public_name` null, the byline falls
back to `"A cook"` ([Potluck.tsx:166](../../../src/pages/Potluck.tsx)). So the impersonation
is gone, but what replaces it is an anonymous byline with nothing nudging them to fix it, and
"A cook" is a dead end for readers too.

**And there is no way to say "you got this wrong".** `PRODUCT.md` has recorded since 4a that
there is exactly one moderator and no appeal path. With one moderator that gap is not
theoretical: there is nobody to notice a mistake.

## Part 1: the notice

A banner at the top of the app shell, shown on every page while the state holds, in the
error colour. It says three things, in this order, because that is the order of what the cook
needs: what happened, what it means for their recipes right now, and what to do about it.

> Your public name was removed by a moderator: impersonation. **Your public recipes are
> hidden from Potluck until you set a new public name.** Set one in Settings, or appeal.

A quieter inline note on Potluck itself, because that is where the consequence is visible.
Not red there: on Potluck it is an explanation, not an alarm.

**The banner clears when the state clears**, which is the moment they set a public name. It
is not dismissible, and that is deliberate: it describes a live state rather than an event, so
a Dismiss button would let a cook hide a thing that is still true. This also means no new
column and no migration for Part 1.

## Part 2: hiding, and the one place it may live

While `name_cleared_at is not null AND public_name is null`, that cook's public recipes do
not appear in Potluck.

**The rule goes inside `search_recipes` and nowhere else.** This is not a style preference.
`listPublicRecipes` routes every feed query, searched and unsearched, through that one
function, and its comment records why: a second path that queried `recipes` directly silently
bypassed every rule the function held, so a muted cook stayed in the feed until you typed
something. A filter added in the client would reintroduce exactly that, and would also be
wrong, since RLS hides the rows where someone blocked YOU, so only the database can see both
halves.

What hiding does NOT do, stated so nobody assumes otherwise:

- The recipe stays `visibility = 'public'`, so a direct link still opens, exactly as a blocked
  cook can still read a public page. The honesty rule from 4b applies: the UI must not claim
  the recipes are private.
- Their own vault, their family and their cook page are untouched.
- It self-heals. Set a public name and the recipes return, with no moderator involved.

## Part 3: appeals

Any cook with a live moderation action against them may appeal it once at a time.

| What can be appealed | Granting it means |
| --- | --- |
| A cleared public name | `name_cleared_at` is nulled, so the hiding stops and the record goes |
| A removed recipe | `removed_at` is nulled, and it can be published again |
| A suspension | `suspended_at` is nulled |

```sql
create table appeals (
  id uuid primary key default gen_random_uuid(),
  cook_id uuid not null references profiles(id) on delete cascade,
  -- 'name' | 'recipe' | 'suspension'. A recipe appeal carries the recipe; the other two
  -- carry null, because the subject IS the cook.
  subject_type text not null check (subject_type in ('name','recipe','suspension')),
  subject_id uuid references recipes(id) on delete cascade,
  body text not null check (length(btrim(body)) between 1 and 1000),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  -- 'granted' | 'declined', null while open
  outcome text check (outcome in ('granted','declined')),
  moderator_note text
);
```

Rules:

- **One open appeal per cook per subject.** A partial unique index on the open ones, not a
  check constraint, because "open" is a state rather than a column value.
- A cook reads and writes only their own appeals. A moderator reads all and resolves them.
  Both through RLS, keyed the same way the reports policies are.
- **A suspended cook can still appeal.** Suspension blocks publishing, not signing in, which
  is what makes an appeal possible at all. Worth stating because a design that locked them out
  would make the appeal path decorative.
- Appeals appear in `/moderation` beside reports, with the cook's name, what they are
  appealing and their words.
- Granting performs the undo in ONE transaction with the resolution, so an appeal cannot be
  marked granted while the action it reverses is still in force.
- The cook sees the outcome where they saw the notice.

## Deliberately NOT in 4c

- **Appealing twice.** One open appeal per subject. A declined appeal is final here, because
  with one moderator a second round is the same person reading the same words.
- **A moderator explaining a decline.** `moderator_note` exists and is shown if filled, but
  nothing requires it. Forcing prose would produce "no" written longer.
- **Notifying the moderator by email.** `notify-report` already covers reports;
  `moderation@enamelvault.com` now works, so this is easy to add later and is left out to keep
  this change reviewable.
- **An appeal for a mute or a block.** Those are personal preferences between two cooks, not
  moderation, and 4b settled that they are never disclosed.
