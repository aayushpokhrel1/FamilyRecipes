# Moderation: report, review, take down (Phase 2, sub-project 4a)

Date: 2026-09-28
Status: built and deployed, 2026-09-29
Follows: `docs/superpowers/specs/2026-09-28-save-and-fork-design.md` (sub-project 3, SHIPPED)

## Why this exists

`PRODUCT.md` has said since Potluck shipped that moderation is **the** gate on opening Potluck
to the public: no report, no block, no takedown, no handling of a handle that impersonates
someone. Potluck is signed-in only today, and that is a discovery brake rather than a safety
one, because public rows are readable by the anon role through the API.

Aayush's answer on 2026-09-28: moderation here means all three of decency, ownership and
impersonation, and **Potluck is opening to strangers soon**. That answer is what unblocked
this design, and it is also what makes the full path necessary rather than a token gesture.

## Scope: this is 4a, the spine

The three problems share one shape: something is reported, you review it, you act. They differ
only in target and remedy. 4a builds that spine for **recipes**. 4b, a separate spec, adds
personal controls (block and mute a cook, which is a viewer preference rather than moderation)
and the handle rules that impersonation actually needs.

## Decisions taken

| Decision | Chosen | Why |
| --- | --- | --- |
| Takedown vs copies | **Unpublish the original; copies stay** | Sub-project 3 promises that nothing the original cook does may change your copy. A cascade would let a takedown destroy a recipe a family had already adapted. A genuinely severe case is handled by hand, which is rare enough not to build for. |
| Review surface | **An in-app `/moderation` page**, plus an email nudge | You will be on a phone when a report lands. Acting must be one tap, not hand-written SQL against production. |
| Suspension | **In scope**, as a third resolution | Strangers in numbers make per-recipe whack-a-mole untenable. |
| Telling the author | **Yes, on their own recipe** | Silent removal is what people find unfair, and it costs one field rendered on a page they already visit. |
| Terms | **A gate after authentication**, not a signup checkbox | See below. |

## Data model

```sql
alter table profiles
  add column is_moderator boolean not null default false,
  add column suspended_at timestamptz,
  add column suspended_reason text,
  add column terms_accepted_at timestamptz,
  add column terms_version text;

alter table recipes
  add column removed_at timestamptz,
  add column removed_reason text;

create table reports (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references recipes(id) on delete cascade,
  reporter_id uuid not null references profiles(id),
  reason text not null,
  note text,
  status text not null default 'open',
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references profiles(id)
);
```

`reason` is a small fixed set enforced by a check: `not_a_recipe`, `offensive`, `not_theirs`,
`impersonation`, `other`. A free-text `note` carries the rest. An enum was rejected because
adding a value to a Postgres enum is a migration this project does not want for a label.

One open report per person per recipe, so a single angry reporter cannot flood the queue:

```sql
create unique index reports_one_open_per_reporter
  on reports (recipe_id, reporter_id) where status = 'open';
```

## Three rules that are easy to get wrong

### A taken-down recipe cannot be re-published by its author

Without this, takedown means nothing: the author flips `visibility` back to `public` and the
content returns. Only a moderator may clear `removed_at`. Enforced by trigger, with the
moderator's own clearing allowed:

```
if new.visibility = 'public' and new.removed_at is not null then reject
```

### Suspension is enforced by a TRIGGER, not by editing the RLS policies

A suspended cook may not publish anything. The obvious implementation is to add a clause to the
recipes RLS policies, and this repo has already paid for that twice: a policy's definition is
whichever migration last touched it, and migration `0009` exists only because `0006` silently
dropped a column while redefining something. A trigger is a NEW object that cannot silently
change the meaning of an existing policy, and it puts the publish rules in one place beside
the removed-recipe rule above.

### The takedown is a state, not a deletion

Taking a recipe down sets `visibility = 'family'` and records `removed_at` and
`removed_reason`. The recipe stays in its author's vault, editable, cookable, plannable. It
simply stops being public. This matches what Aayush chose about telling the author, and it
means a mistaken takedown is reversible.

## The email nudge

A new edge function `notify-report` sends through Resend. Resend today is only Supabase's
auth SMTP, configured in the dashboard: **there is no app-level send path**, so this is a new
function, a new `RESEND_API_KEY` secret, and a manual deploy. The edge function is never
deployed automatically, so `npx supabase functions deploy notify-report` is a step that must be
in the plan.

**The client calls it after the report row is written, not a database trigger.**

```
ponytail: best-effort notify. The report ROW is the record; the email is only a nudge.
Calling from the client avoids pg_net, a service key stored in the database, and a webhook.
The cost is that a tab closed at the wrong moment loses the EMAIL, never the report, and
/moderation still shows it. Move this to a database trigger only if a missed email ever
actually matters.
```

The function sends only to a moderator address from its own environment. It never sends to a
user-supplied address, and its body carries ids and the reason, never the reporter's identity.

## Terms and acceptable use

A static `/terms` page saying what may be published, what gets removed, and how to reach a
human. Linked from the footer and the gate below.

**The gate sits after authentication, not on the signup form.** A checkbox on the signup form
would miss Google sign-in, which never touches that form, and would miss every account that
already exists, which right now is all of them. One gate, shown whenever `terms_accepted_at`
is null or `terms_version` is behind the current version, covers email signup, Google signup
and existing users with a single mechanism. It lives with `RequireAuth` in `src/routes.tsx`,
which already wraps exactly the routes that need it.

Versioning means the terms can change and everyone is asked again. `TERMS_VERSION` is one
constant in the frontend; a mismatch re-prompts.

## Interface

- **Report**: on a public recipe that is not yours, beside Save. A small form: reason, optional
  note. After sending, the control reads "Reported" and does not resend.
- **`/moderation`**: gated on `is_moderator`, listing open reports newest first, each showing
  the recipe, the reason and the note, with **Unpublish**, **Suspend cook** and **Dismiss**.
  Not in the nav for anyone else, and the route itself checks the flag rather than relying on
  the nav hiding it.
- **The author's view**: a recipe with `removed_at` shows "Removed from Potluck" and the reason
  on its own page, in their vault.
- **A suspended cook** sees why on their own recipes and in settings, rather than finding that
  publishing silently fails.

`is_moderator` is set by hand in SQL. There is no UI for granting it and there should not be
one while there is exactly one moderator.

## Testing

Integration, because the risky half is RLS and triggers:

- a signed-in user can report a public recipe; a second open report from the same person is
  rejected by the unique index
- a non-moderator cannot read the reports table at all, and cannot set `removed_at`
- a moderator can read every report and take a recipe down
- **a taken-down recipe cannot be re-published by its author** (the trigger)
- **a suspended cook cannot publish anything**, new or existing (the trigger)
- taking down a recipe leaves existing COPIES of it untouched, which is sub-project 3's promise
- clearing `removed_at` as a moderator lets the recipe be published again

Unit: the report form's three states, the moderation list's actions, the removed banner, the
terms gate (shown when null, shown when the version is behind, hidden once accepted).

**The permission tests are run red first.** A policy test nobody has seen fail is not evidence,
which this project relearned in sub-project 1, and again in sub-project 3 where a denial test
passed while the function under test did not yet exist.

## Out of scope

- **Block and mute a cook**, and the handle and impersonation rules: 4b.
- **Appeals**, an audit log of moderator actions, and any automation or scoring. One moderator,
  no volume; build them when there is volume to justify them.
- **Reporting a cook** rather than a recipe. Impersonation is reported through a recipe's
  reason code for now; 4b gives the cook its own target.
- **Purging copies** on takedown. Deliberate, see above.
- **Actually opening Potluck to the public.** A one-line route change, and a separate decision
  that should follow this landing, not accompany it.
