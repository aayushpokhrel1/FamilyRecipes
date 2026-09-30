# Block, mute, and who you say you are (Phase 2, sub-project 4b)

Date: 2026-09-29
Status: SHIPPED (deployed 2026-09-29; verified locally in a browser, not yet on production)
Follows: `docs/superpowers/specs/2026-09-28-moderation-spine-design.md` (sub-project 4a, SHIPPED)

## Why this exists

4a built the spine: report a recipe, review it, take it down, suspend a cook. It deliberately
left out the two things that are not about a single recipe.

**Personal controls.** Most of what makes a feed unpleasant is not a rule violation. Someone
posts a lot, or posts things you do not want to see, and reporting them would be wrong. That is
a preference, not moderation, and it should not need a moderator's attention.

**Who you say you are.** `handle` is already unique and constrained to `^[a-z0-9_]{3,30}$`, and
`handle is not null` IS the opt-in to publishing. But **`public_name` is free text with no
constraint at all**, so anyone can call themselves someone else. That is the actual
impersonation vector, and 4a's report path targets a recipe, so today it cannot even be
reported.

## Decisions taken

| Decision | Chosen |
| --- | --- |
| Mute | Soft, one-way, feed only. Their recipes stop appearing in your Potluck. Nothing else changes and they are never told. |
| Block | Everything mute does, plus: any follow between you is removed, they cannot follow you again, and your recipes stop appearing in their Potluck. |
| Impersonation | Reported like anything else, but targeting a COOK. The moderator clears `public_name`; the cook is told, the same shape as a recipe takedown. |
| Handles | Not released, not reclaimed. See below. |

## The honest limit on "hide my recipes from them"

**Block is a UI courtesy in that direction, not a boundary, and the copy must not say
otherwise.** Public rows stay readable by the anon role through the API, which is exactly what
makes public recipe pages and link previews work at all (recorded in `PRODUCT.md` since
Potluck shipped). A blocked cook who signs out, or who opens the link in a private window, can
still read the recipe.

So the UI says something true, such as "They will not see your recipes in Potluck", and never
"They cannot see your recipes". Writing a promise the architecture cannot keep is worse than
offering the weaker feature honestly, and this is the single most likely place in 4b to do it.

## Data model

```sql
create table blocks (
  blocker_id uuid not null references profiles(id) on delete cascade,
  blocked_id uuid not null references profiles(id) on delete cascade,
  -- 'mute' is one-way and feed only; 'block' also severs follows both ways
  kind text not null check (kind in ('mute', 'block')),
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  constraint no_self_block check (blocker_id <> blocked_id)
);
```

One row per pair, with `kind` rather than two tables: they differ in what they DO, not in what
they are, and two tables would mean two policies, two queries and a way to be in both at once.
Changing mute to block is an update, not a delete and an insert.

Private to the blocker, mirroring `follows`, which is deliberately readable only by the
follower so no follower list can leak:

```sql
create policy block_own on blocks using (blocker_id = auth.uid());
```

**A blocked cook is never told, and must not be able to find out.** That is why the read policy
is the blocker's alone, and why blocking does not produce a report or any visible change on
their side beyond recipes quietly not appearing.

## Severing the follow

Blocking removes any follow in either direction, and prevents a new one. The removal is a
delete at block time; the prevention is a policy addition on `follows`, since a check
constraint cannot see another table:

```sql
-- added to the follows insert policy
and not exists (
  select 1 from blocks b
  where (b.blocker_id = cook_id and b.blocked_id = follower_id and b.kind = 'block')
     or (b.blocker_id = follower_id and b.blocked_id = cook_id and b.kind = 'block')
)
```

**This is the one place in 4b that touches an EXISTING policy**, which is where this repo has
been bitten twice: a policy's definition is whichever migration last touched it, and `0009`
exists only because `0006` redefined one and silently dropped a column. So the migration
restates the follows insert policy in full, with a comment naming the clause that is new, and
the integration tests re-assert the ORIGINAL follow behaviour as well as the new rule.

## Filtering the feed

`search_recipes` already serves both the vault and the public catalogue and is the one matching
rule for both (migration `0025`). The block filter belongs there, not in a second query, for
the same reason: a second path is how the two silently drift apart.

The filter is symmetric, and that symmetry is the whole of "they will not see your recipes in
Potluck":

```sql
and not exists (
  select 1 from blocks b
  where (b.blocker_id = auth.uid() and b.blocked_id = r.author_id)
     or (b.blocker_id = r.author_id and b.blocked_id = auth.uid() and b.kind = 'block')
)
```

The first line is mute and block hiding them from you. The second is block alone hiding you
from them; mute deliberately does not, because mute is one-way.

This applies only to the public catalogue branch (`p_family_id is null`). **Blocking must never
hide a recipe inside your own family's vault**, or a block would quietly break a household.

## Reporting a cook

`reports.recipe_id` becomes nullable and gains a sibling:

```sql
alter table reports
  alter column recipe_id drop not null,
  add column cook_id uuid references profiles(id) on delete cascade,
  add constraint report_has_one_target check (num_nonnulls(recipe_id, cook_id) = 1);
```

`resolve_report` gains one action, `clear_name`, which blanks `public_name` and records why,
so the cook is told on their own settings page the way an author is told on their recipe:

```sql
alter table profiles
  add column name_cleared_at timestamptz,
  add column name_cleared_reason text;
```

The existing `reports_one_open_per_reporter` index is on `(recipe_id, reporter_id)` and does
not cover cook reports, so it needs a sibling on `(cook_id, reporter_id)`. **Forgetting this is
the obvious bug**: one reporter could flood the queue with cook reports while recipe reports
were rate limited.

## Handles are not released

A reported handle is NOT freed, renamed or reassigned. Handles are the identity in every public
URL (`/cooks/<handle>`), so releasing one breaks every existing link to that cook, including
links family members already hold. Clearing `public_name` removes the impersonation without
breaking anything, and a handle that is genuinely abusive can be dealt with by suspending the
account, which 4a already does.

This is a deliberate reversal of the obvious answer, and the reason is recorded here so it is
not re-litigated: the handle is not the lie, the display name is.

## Interface

- **On a cook page**: a quiet control offering Mute and Block, and Report.
- **In Settings**: a list of who you have muted or blocked, with an undo. A block you cannot
  find again is a trap.
- **A cleared name**: the cook sees, in Settings, that their public name was removed and why.
- **Nothing anywhere** tells a cook they have been muted or blocked.

## Testing

Integration:

- a muted cook's recipes vanish from your Potluck, and yours stay visible to them
- a blocked cook's recipes vanish from your Potluck, and yours vanish from theirs
- blocking removes an existing follow in BOTH directions
- a blocked pair cannot create a follow either way
- **the original follow behaviour still works between unblocked cooks** (the restated policy)
- blocks are invisible to the blocked cook: they cannot read the blocks table at all
- **a block never hides a recipe inside your own family's vault**
- a cook report and a recipe report can both be open from one reporter, but not two cook
  reports on the same cook
- `clear_name` blanks `public_name` and records the reason

Unit: the mute and block controls and their undo, the Settings list, the cleared-name notice,
and that the block copy says "will not see your recipes in Potluck" rather than "cannot see".

**The block and follow policy tests are run red first**, and the restated follows policy is
tested for what it always did as well as for what is new.

## Out of scope

- **Telling anyone they were blocked.** Deliberate, permanently.
- **Blocking a whole family** rather than a cook.
- **Appeals, audit logs, automation.** Same reasoning as 4a: one moderator, no volume.
- **Anything that would make a public recipe unreadable to the anon role.** That would break
  public pages and link previews, and it is not what block is for.
