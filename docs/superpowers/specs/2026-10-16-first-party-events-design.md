# First-party events: returning users and funnels

Agreed 2026-10-16. Four questions a moderator can act on, answered from rows we hold
ourselves, with nothing stored on the device and therefore no consent banner.

## Intent, and the why

Every fix in recent sessions came from Aayush using the app and noticing friction. That
finds defects well and answers nothing about whether anyone else is there. Cloudflare's
cookieless page count was supposed to cover it and does not: its collector returns 404, and
even working it cannot tell a returning cook from a new one, nor say where somebody stopped.

Four questions, all four confirmed as ones he would act on:

1. **Is anyone coming back?** Do people use it twice, or once and never again.
2. **Where do people fall out of onboarding?** Signed up but never joined a family, joined
   but never saved a recipe.
3. **Which features are actually used?** So the next thing built is one somebody wants.
4. **Does the marketing site produce accounts?** Whether the three new pages turn into signups.

These are for deciding what to build next, not for reporting to anyone. Rough numbers that
are obviously right beat precise ones, and that trade-off is deliberate: where the cheap
answer and the exact answer differ, take the cheap one and label it.

## Goals

- A moderator can read all four answers without asking anyone to run a query.
- The funnel costs no new stored data.
- No cookie, no `localStorage` key, no `sessionStorage` key, so no consent banner.
- Both account-deletion paths erase the new record with no new code in either.

## Non-goals

- Not a click log, not a session recorder, not per-event properties.
- Not a chart library, not a dashboard framework, not a date-range picker. The existing
  30-day bar chart in the overview is the visual vocabulary; reuse it.
- Not anonymous-visitor measurement. Everything here is about a signed-in account. Whether
  strangers read the marketing pages stays Cloudflare's job.
- Not the kitchen app. `kitchen_seal.test.ts` must stay green and no migration here crosses
  schemas.

## Anti-goals, the things that would make this a failure even if it worked

- **A consent banner becoming mandatory.** `src/lib/browserStorage.test.ts` going red is the
  signal that it has happened. That test is the forcing function and must not be softened to
  accommodate anything here.
- **A free-text column a stranger writes.** `?from=` is attacker-controlled input. Validated
  against a fixed list or not stored.
- **A second moderator gate.** There is exactly one place the moderator check lives, the
  `admin` edge function. A new page with its own check would be a copy that can drift.
- **Numbers that quietly conflate two questions.** `AdminStats` already carries a comment
  explaining why `users` and `everJoined` are separate and must not be collapsed. Every number
  added here gets the same treatment: say what it counts, including whom it misses.

## Constraints that come from this repo

- All Supabase access lives in `src/lib/api/`. Nothing outside it imports the client.
- `npx tsc -b && npm test` verifies. A migration also needs `npx supabase db reset`.
- Apply the migration to cloud **before** the frontend that needs it.
- The `admin` edge function does not deploy automatically. Nothing does.
- `supabase/rls.test.ts` requires RLS and at least one policy on a new table, and an
  `on delete` action on any new foreign key to `auth.users`. A table in `public` needs no
  explicit grant: Supabase grants that schema itself.

## The decisions Aayush made

| Decision | Chosen | Rejected, and why it matters |
| --- | --- | --- |
| How he reads the numbers | A page in the app, moderator-only, always current | Running queries on request (nothing built, but he has to remember to ask); a weekly report (needs somewhere to send it) |
| What is recorded | One row per signed-in person per day | A single overwritten `last_seen_at` (no history, so no retention curve); deriving from recipes and comments alone (counts only people who write, and most use is reading) |
| Marketing attribution | A URL parameter, `?from=` | A cookie on the apex: accurate, and it makes a consent banner legally mandatory plus the five other changes `PRODUCT.md` lists. Deferred until there are more users and a reason |
| How long a daily row is kept | Forever, for as long as the account exists | 13 months; 90 days |

"Forever" is bounded by the account: the rows are keyed to a login and die with it, which is
what lets `/privacy` keep its existing promise that deletion leaves only the authorship record.

## How it is built, as decided

### It extends the moderation overview. It is not a new page

`src/pages/Moderation.tsx` is already moderator-only (absent from the nav; the page checks
`is_moderator` itself, and the route comment explains that hiding the link is a courtesy and
not the permission). It already has an `overview` view drawing a 30-day signups chart from
`signupsByDay`, with `lastThirtyDays` already handling gap-filling and the local-midnight trap.

So: new numbers on the `stats` action of the `admin` edge function, new panels in that
`overview` view. This is the reason there is no new migration for a moderator read policy and
no second gate. Reads happen in the function under the service role, which bypasses RLS by
design.

### A new table, `public.activity_days`

One row per person per day **per surface**. Per surface rather than an array of surfaces on a
single daily row, because appending to an array is a read-modify-write race while a separate
row is one idempotent insert; and per day rather than per visit, because a dated record of use
is the smallest thing that answers the retention question.

```
create table activity_days (
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null,
  surface text not null,
  primary key (user_id, day, surface)
);
```

- `on delete cascade` is what makes both deletion paths erase it with no code in either, and
  `rls.test.ts` fails a new `auth.users` reference without an `on delete` action anyway. A
  foreign key defaulting to NO ACTION would be a veto on account deletion, which is the class
  of bug eight `kitchen` columns already caused.
- RLS enabled, with one policy: insert, own row only, `with check (user_id = auth.uid())`.
  **No select policy for anyone.** A moderator reads it through the function, so a user who can
  write a row cannot read anybody's, including their own. RLS with one policy satisfies
  `rls.test.ts`; a table with no policy at all would not.
- Bounded at roughly a dozen rows per person per day by the surface list below.

### `profiles.signup_source`, written once

A nullable text column. Written **once**, after the session exists, only when it is still
null, so it records the first arrival and is never overwritten by a later visit through a
different page.

Validated against a fixed list, `hub | family | professional`, in the same spirit as
`safeNext` in `src/lib/nextPath.ts`: anything else is dropped and nothing is stored. This is a
trust boundary, not a tidy-up.

`handle_new_user` is **not** changed. 0037 carries a warning about that function and 0032 says
it is deliberately left alone; and the trigger cannot see a URL parameter anyway. Google's
OAuth flow does not let the app set user metadata, so a trigger-based answer would work for
email signup and silently never fire for Google, which is exactly the shape of the bug 0037
exists to document.

### Carrying `?from=` through sign-up

The parameter has to survive a redirect through another origin (Google) and an email
confirmation opened later in another tab. That is the problem `src/lib/nextPath.ts` already
solves for `next`, and the rule in `CLAUDE.md` is absolute: anything that must survive signing
in goes in the URL, never in router state, and never in device storage. Putting it in
`localStorage` would take `browserStorage.test.ts` red, which is the correct alarm, not an
inconvenience to route around.

So `from` rides in the URL beside `next` the whole way: on the marketing links, through
`/signin` and `/signup`, into the OAuth `redirectTo` and the email `emailRedirectTo`, and is
read at the end of the flow where the session first exists.

### The surfaces, and where a visit is recorded

`AppLayout` renders inside `RequireAuth` and `TermsGate`, so it is the one component every
signed-in route passes through. Record from there, on pathname change, mapping the first path
segment to a coarse surface name: `recipes`, `families`, `potluck`, `kitchen`, `cupboard`,
`cookmode`, `drafts`, `settings`, `profile`, `moderation`.

Coarse on purpose. A route is an implementation detail that will be renamed; "which features
are used" is a product question and the answer should survive a refactor.

Deduplicate in memory for the life of the tab, so a cook moving between pages does not send
the same `(day, surface)` repeatedly. **In memory only**, not a storage key, for the reason
above. A duplicate that slips through is harmless: the insert is idempotent on the primary key.

### The four answers, computed in the `admin` function

Following the precedent already set there, per-day bucketing is done in TypeScript rather than
SQL **where that avoids a migration**, and the existing `count()` helper and
`admin.auth.admin.listUsers` total are reused.

1. **Returning users.** From `activity_days`: how many distinct people have rows on two or
   more distinct days, and the count active in the last 7 and 30 days. Honest ceiling to state
   in a comment: this starts empty and means nothing until it has been collecting for a while,
   so the panel says so rather than showing a confident zero.
2. **The funnel.** Three counts from `created_at` columns that already exist: profiles, then
   profiles with a `family_members` row, then profiles with at least one recipe. No new data.
   Count profiles, not logins, and say which, because a profile outlives its login on purpose.
3. **Feature use.** Distinct people per surface over the last 30 days, from `activity_days`.
4. **Marketing credit.** Counts grouped by `profiles.signup_source`, with null meaning
   "arrived without a credited link", which includes everyone who signed up before this
   shipped. The panel must label that null rather than presenting it as "direct".

### The public documents

`Privacy.tsx` has to describe the new record: that a dated note of which parts of the app an
account opened is kept while the account exists, and that it is erased with the account.
`signup_source` is covered by the same paragraph.

`TERMS_VERSION` is **not** bumped: it fingerprints `Terms.tsx`, and the terms wording does not
move. `src/components/TermsGate.version.test.ts` is what holds that, and it should stay green
through this change. If it goes red, the terms were edited and the version does have to move.

No third party is added, so `Privacy.tsx`'s processor list and `supabase/processors.test.ts`
are untouched.

The marketing footers must keep saying what is true. `src/site.claims.test.ts` already fails
if the denial of analytics returns; adding a `?from=` parameter to a link sets nothing on the
device and does not change what those pages may claim.

## Three calls made after the builder check, not decisions Aayush made

A builder reading this document would have had to guess at three things where a wrong guess
would matter. They are settled here rather than left open.

### Whose clock decides `day`, and why the column is constrained

**The client sends its own local date.** Not `default current_date`, which is UTC: this repo
already paid for that distinction once, and `lastThirtyDays` in `Moderation.tsx` carries the
comment explaining that `toISOString` shifts local midnight in any UTC+ timezone onto the
previous day, moving the whole row by one. A retention curve built on UTC days and drawn
against a chart built on local days would disagree with itself and nobody would be able to
tell which was wrong.

A client-supplied date is client-supplied input, so the column takes a check constraint that
`day` is within a day either side of `current_date`. Without it a cook can write any date into
their own row, which RLS permits because it *is* their row, and forge a retention history.
The harm is bounded, the constraint is one line, and the alternative is a number that cannot
be trusted on exactly the question the feature exists to answer.

### The insert is an upsert that ignores duplicates

"One idempotent insert" is the behaviour; a plain insert on an existing primary key raises a
duplicate-key error, and a cook moving around the app would generate a stream of them. So the
write is an upsert on `(user_id, day, surface)` with duplicates ignored, which is a single
statement, needs no read first, and is safe to call from more than one tab at once.

Note what this does NOT change: a write refused by RLS is still to be checked. An insert that
violates a policy raises rather than reporting zero rows, which is the opposite of the
silent-refusal class this project keeps hitting, but the write still belongs in
`src/lib/api/` like every other one.

### Marketing credit is only written to an account that was just created

The marketing pages link to `/signin` as well as `/signup`, so writing `signup_source`
whenever it is null would credit an existing cook who happened to arrive through a marketing
link. Worse, it would credit every account that existed before this shipped, since all of
their sources are null, and the panel would report the marketing site as having produced
accounts that predate it.

So the write is conditional on the account being new: `signup_source` is set only when the
profile is still null **and** the profile was created within the last few minutes. The
question the panel answers is "did this page produce an account", and an account that already
existed cannot have been produced by it.

### Every panel shows the total and the non-moderator figure beside it

Aayush's decision, 2026-10-16. He is currently most of the traffic, so a single total would
mostly report him back to himself on every panel. Excluding moderators outright was rejected
because his own use is the only use that currently finds bugs, and a panel that cannot see it
hides them.

So each number is a pair: everyone, and everyone who is not a moderator. The pair is labelled,
for the same reason `users` and `everJoined` are labelled in `AdminStats`: two numbers that
answer slightly different questions must never be collapsed into one that answers neither.

## What the builder decides

- The SQL and TypeScript shape of each aggregate, and whether any of them is cheap enough in
  SQL to be worth a view. Default to the function, matching `signupsByDay`.
- Panel layout and wording inside the existing `overview` view, using classes
  `src/index.css` actually defines. An invented class renders unstyled and fails nothing.
- How the `from` parameter threads through the existing sign-in surfaces, and whether it lives
  in `nextPath.ts` beside `safeNext` or in a sibling module.
- Test placement, within the project's rules: a unit test for every pure helper, an
  integration test for what only a real database can prove.

## What must be true before it is called done

- `npx tsc -b && npm test` clean, and `npm run test:int` after `npx supabase db reset`.
- An integration test proving the write policy: a signed-in user may insert their own row,
  may not insert somebody else's, and may not read anybody's. Asserted as that user, never
  through the service role, which bypasses RLS and would pass however broken the policy is.
- An integration test deleting an account that has activity rows, proving the rows go and the
  deletion is not vetoed.
- `kitchen_seal.test.ts`, `browserStorage.test.ts`, `site.claims.test.ts`,
  `TermsGate.version.test.ts` and `rls.test.ts` all green.
- Migration applied to cloud **before** the frontend ships, and the `admin` function
  redeployed by hand.
- Walked in a browser on a fresh account at 375 and 1024, as a non-moderator (the panels must
  be unreachable) and as a moderator (they must show real numbers), because defects keep
  shipping past a green suite and being found in a browser.
