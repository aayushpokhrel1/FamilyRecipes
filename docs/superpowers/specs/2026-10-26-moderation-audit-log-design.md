# The moderation audit log

**Decided 2026-10-26.** `PRODUCT.md` holds the entry this comes from: a second moderator, an
audit log, and an admin console of its own, in that order. This is the audit log. The console's
move to its own surface is a later change and nothing here may assume it.

## Why now

A suspension, a promotion, a name clearing, a takedown or a deletion currently leaves no record
of who did it. With one moderator that is untidy. With two it means the question "who acted on
this cook" has no answer, and `docs/OPERATIONS.md` has said so from the start. A second
moderator is coming, which turns the untidiness into a requirement.

The hole is uneven rather than total, and the unevenness is the interesting part:

| Path | What it records today |
| --- | --- |
| `resolve_report` (0055) | `resolved_by` and `resolved_at` on `reports`, but NOT which of the four actions was taken. `unpublish`, `suspend` and `clear_name` all land as `status = 'actioned'` |
| `resolve_appeal` (0053) | `resolved_at`, `outcome`, `moderator_note`, and **no actor at all** |
| the `admin` edge function | nothing. Six direct controls (`suspend`, `unsuspend`, `set_moderator`, `delete_user`, `takedown_recipe`, `restore_recipe`) write only the effect onto the target row |

So a reason survives (`suspended_reason`, `removed_reason`, `name_cleared_reason`) while the
actor does not, except on reports. A reason with no author is the shape of the problem.

## Goals

- Every moderator action, through every path, leaves one dated row naming the actor, the action,
  the subject, and the reason.
- A moderator can read the trail without a SQL console, because the second moderator will not
  have one.
- Promotion to moderator is Aayush's alone.

## Non-goals

- The console's move to its own host. `PRODUCT.md` has what that costs; this change adds a tab
  to the console where it already lives.
- Retrofitting history. There is no record to backfill from, so the log starts empty and the
  first row is the first action after deploy. The console must say so, the same way the activity
  figures say when collecting began.
- Kitchen actions. The `kitchen` schema has its own authority model and no moderator concept.
  `kitchen_seal.test.ts` holds that line and this change does not touch it.

## Anti-goals

Things that would make this a failure even if it worked:

- **A second source of truth for authority.** `is_moderator` on `public.profiles` stays the only
  answer to "may this person moderate". The owner check added below narrows ONE action and
  introduces no third role.
- **A log the subject of an action can read or edit.** It names who acted; handing that to the
  person they acted on is a safety problem, not a transparency win.
- **A log a moderator can write by hand.** An entry that can be forged or deleted by the person
  it describes is worse than none, because it would be believed. The same reasoning as
  `record_terms_acceptance` in `0047`.

## Constraints that bite

- **A write refused by RLS is not an error** (`CLAUDE.md`). Every new write must `.select()` what
  it wrote, and the read policy here is wider than the write policy by design, which is exactly
  the shape that produced three bugs in one day.
- **`profiles` has column-level update grants.** `0047` grants update on six named columns only,
  so a new column on `profiles` is not self-settable and `profiles_self_update` does not change.
  That policy's `with check` was added in `0047` precisely because `is_moderator` had been a
  one-request path to moderator; do not widen it.
- **A new definer function taking a uuid must tie it to `auth.uid()`** and `rls.test.ts` fails
  one that does not. The writers here take no uuid from the caller: they are inside functions
  that already resolved the subject, or they run under the service key after the JWT check.
- **A new table needs RLS, a policy, and its write privileges revoked**, and every FK needs an
  `on delete` action or it becomes a veto on account deletion (`0059`).
- **Report-driven actions do NOT move into the edge function.** That file's own header says
  `resolve_report` stays the only place a report changes state so there is one trail rather than
  two. This change keeps both paths and makes them write to the same place.

## The design

### One append-only table

`public.moderation_events`, migration `0066`:

- `id uuid primary key default gen_random_uuid()`
- `at timestamptz not null default now()`
- `actor_id uuid references profiles(id) on delete set null` (nullable: an event whose actor's
  profile row is gone is still a record of the event)
- `action text not null`, checked against an allowlist
- `via text not null check (via in ('direct', 'report', 'appeal'))`
- `subject_cook uuid references profiles(id) on delete set null`
- `subject_recipe uuid references recipes(id) on delete set null`
- `report_id uuid references reports(id) on delete set null`
- `appeal_id uuid references appeals(id) on delete set null`
- `reason text`

`actor_id` points at `profiles`, not `auth.users`, deliberately: a profile row outlives its login
on purpose (`0014`), so the trail keeps the actor's name after that moderator deletes their own
account. An FK to `auth.users` would have been the eighth veto on account deletion that `0059`
had to undo.

The action allowlist, with the via each one arrives through:

| action | via | written by |
| --- | --- | --- |
| `suspend` | `direct`, `report` | edge function, `resolve_report` |
| `unsuspend` | `direct`, `appeal` | edge function, `resolve_appeal` |
| `set_moderator`, `unset_moderator` | `direct` | edge function |
| `delete_user` | `direct` | edge function |
| `takedown_recipe` | `direct`, `report` | edge function, `resolve_report` |
| `restore_recipe` | `direct`, `appeal` | edge function, `resolve_appeal` |
| `clear_name` | `report` | `resolve_report` |
| `restore_name` | `appeal` | `resolve_appeal` |
| `dismiss_report` | `report` | `resolve_report` |
| `grant_appeal`, `decline_appeal` | `appeal` | `resolve_appeal` |

`resolve_report`'s `unpublish` is logged as `takedown_recipe`, because the two paths do the same
thing to the same row and a reader asking "when did this recipe come down" should not have to know
which door it came through. A granted appeal writes TWO rows: the outcome (`grant_appeal`) and the
undo it performed (`unsuspend`, `restore_recipe` or `restore_name`), because the outcome and the
remedy are separately interesting and `resolve_appeal` already branches on both.

**RLS: one select policy for moderators, and nothing else.** No insert, update or delete policy
exists, which is the strictest setting rather than a gap, the same reasoning `extract_log` carries
in `rls.test.ts`. The only writers are the two definer functions (which bypass RLS by definition)
and the service-role client in the edge function. Write privileges are revoked from `anon` and
`authenticated` as well, because Supabase's `alter default privileges` grants them and `0056`
is the incident that proves a privilege nobody granted is still a privilege.

### The two gaps on the existing tables

Both are recorded in their own right, not only in the new table, because the existing rows are
the ones a reader lands on first:

- `appeals.resolved_by uuid references profiles(id) on delete set null`, set by `resolve_appeal`
  from `auth.uid()`. `reports` has had this since `0028`; `appeals` never did.
- `reports.resolved_action text`, set by `resolve_report` to the action it took. Today the row
  says an action happened and not which one.

Both are restated-in-full `create or replace` definitions carrying the previous body verbatim,
which is how `0055` and `0053` handled the same functions, and both migrations end with the
three-line revoke and re-grant trailer copied from the previous migration.

### Promotion is Aayush's alone

`profiles.is_owner boolean not null default false`, set true in the migration by
`update profiles set is_owner = true where is_moderator = true`, which is exactly one row today.
The migration asserts that it touched exactly one row rather than trusting it.

It is NOT added to `0047`'s update grant, so no client can set it and `profiles_self_update` is
untouched. There is no UI to set it and no action in the edge function that writes it: a second
owner is a SQL console job, deliberately, because the point of the column is that the app cannot
hand out the authority that hands out authority.

The edge function reads `is_owner` in the same select as `is_moderator`, with the caller's own
client, and `set_moderator` refuses a caller without it. The refusal message names the reason, as
every other refusal there does.

**The browser hides the control rather than only catching the refusal.** `CLAUDE.md`: a page must
not render a control its viewer's policy will refuse. The `users` response grows
`callerIsOwner: boolean` and `Moderation.tsx` renders the promote and demote controls only when
it is true. The function still refuses regardless, because the browser check is a courtesy and
the function check is the enforcement. This is the one place `admin.ts`'s standing comment (the
browser deliberately does not re-check the caller's role) is departed from, and the reason is that
the comment is about re-implementing a check, while this is about not drawing a dead button.

### Reading it

A read-only section in `src/pages/Moderation.tsx`, behind the console's existing moderator gate,
listing when, who, what, to whom, and why, newest first, paged the same way the user list is.

The edge function gains an `events` action. It resolves `actor_id` and `subject_cook` to display
names with the service-role client, because `profiles_self_read` hides every other profile row
from a moderator's browser client too, which is the reason this function exists at all.

The page states that collecting began on the deploy date, because an empty log and a quiet month
look identical and the activity panel already set the precedent of saying so.

## Left to the builder

- Whether the events section is a tab beside the existing ones or a block on the people view.
  The console's current structure decides it; match what is there.
- The page size. 100 matches the user list and there is no reason to differ.
- Column naming inside the new table beyond what is listed above.
- Whether `Privacy.tsx` needs a wording change. Moderation records already survive deletion and
  that page says so, so this is a check rather than an assumed edit: read the page and decide.
  If it does change, `legalDates.version.test.ts` governs the dated constant.
