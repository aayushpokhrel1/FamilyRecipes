# Giving the kitchen its own measurement

Design, 2026-10-21. Approved in brainstorm by Aayush; decisions attributed below are his unless
marked as mine.

## Intent

The kitchen app records a great deal and reports none of it. `PRODUCT.md` has carried "giving the
kitchen its own measurement is undesigned" since the app went live on 2026-10-12, and the
moderator console's Kitchen section can only count rows that exist: kitchens, venues, staff,
dishes, published, open invites, and a funnel. It can say nothing about whether a group gets
anything finished, where it gets stuck, or whether its staff come back.

This feature answers four questions, chosen in that order of importance:

1. **Does a dish land?** Of the dishes a group starts, how many reach sign-off, and how long from
   the first version to the signature.
2. **Where does a group stall?** Created, site added, dish created, version saved, trialled,
   signed off, on a menu. Which step loses them.
3. **Which sites are real?** A site that has recorded a trial or a substitution, against one that
   is a row somebody typed once.
4. **Does anyone come back?** Per staff member, per group.

**This is not `0060` in another schema.** The family's retention question assumes a user who may
simply stop opening the app; kitchen staff are present by obligation, and `signup_source` means
nothing for an app that is `noindex` and unlinked. The kitchen's question is throughput. Three of
the four answers above need no new storage at all, which is the single most important fact in this
document.

## Who reads it, and where

Two audiences, two read paths, one set of definitions.

**A group's own staff, inside the kitchen app.** This is the new part. Aayush's rule, which
decides every scope question below: **you see numbers for the things you can act on.**

- **Owner and chef** see questions 1 to 3, group-wide. This is zero new exposure: `0041`'s read
  ladder already lets both read every dish, version and deviation in the group, so an aggregate
  over those rows tells them nothing they could not count by hand.
- **Only the owner** is served question 4 and the rest of the people-and-access block (invites
  issued, used, open, aged out; sites closed; dishes retired). Nobody else can issue an invite,
  set a role, remove staff, close a site or erase the group, so nobody else could act on those
  figures.
- **`site_manager` and `cook` get no numbers page at all** in this version. A site-scoped view for
  a site manager is a real idea and is deliberately deferred: it is a second query and a second
  gate, and group-wide figures would be new exposure for a reader whose dish reads are limited to
  the menu stage and to trials at their own site.

**The moderator console, across all groups.** The existing `kitchen_insights` action in
`supabase/functions/admin/index.ts` gains the same figures, aggregated across groups. It stays the
one place both schemas meet, which `supabase/kitchen_seal.test.ts` enforces, and it still only
counts: no kitchen row is ever handed to a family user.

## Where it appears in the app

Aayush chose both halves: a small strip of figures in the place that already exists, and a page
with the full version.

**The group list gains a strip.** `src/kitchen/pages/Dashboard.tsx` is "Your kitchens", a list of
the groups you are staff of. There is no per-group home page and `/orgs/:id` has no index route,
so the strip goes on each group's line: the three figures from question 1 for a group where you
are owner or chef, and nothing for a group where you are not.

**A `Numbers` page in the group nav.** A fifth item in `OrgLayout.tsx` after Sites, Staff and
Dishes, at `/orgs/:id/numbers`, holding the full version in this order:

1. **Does a dish land.** Signed off out of started, median days from first version to sign-off,
   and how many have been in development over a month, with the slow ones named and linked.
2. **Where it stalls.** The funnel as one line, one count per step.
3. **Which sites are real.** A line per site: substitutions, trials, and when anything was last
   recorded. A site with nothing recorded says so and names when it was added.
4. **People and access, owner only**, below a rule, with a row per staff member: name, role, site,
   how many of the last seven days they were back, last seen, and "never opened it" called out for
   someone who joined and never arrived. Then the invite counts and the closed or retired counts.

The strip and the page read the same definitions. The strip is a summary of block 1, never a second
set of figures computed a second way.

## Per-person attendance, and what it costs

Aayush decided that an owner sees **a row per person**, not a group figure, having been told that
this makes the feature staff monitoring rather than a usage measurement, and that the family app
refused the comparable thing when it ruled out follower counts. That decision stands and the rest
of this section is its price, all of which is part of this change and not a follow-up.

- **The kitchen privacy page must say it**, plainly: that the app records the days a staff member
  opens it, and that the group's owner can see that per person by name.
- **That is a wording change to a gated document**, so `KITCHEN_TERMS_VERSION` in
  `src/kitchen/components/KitchenTermsGate.tsx` and `KITCHEN_TERMS_UPDATED` in
  `src/lib/legal.ts` are both bumped and every staff member is re-asked at next sign-in.
  `src/kitchen/components/KitchenTermsGate.version.test.tsx` fails until they are, which is the
  mechanism working. Pass a FULL path to `sourceText` in `src/lib/termsFingerprint.ts`: both apps
  have a `pages/Terms.tsx` and a bare suffix matches both.
- **Whether the join page also says it before someone accepts** is open and does not block the
  build. `JoinByLink` already names the group and the role before asking for anything, so it is
  the honest place for it. Aayush's call.

## The one new table

`kitchen.activity_days`, in its own migration, carrying `0060`'s reasoning where it still applies
and departing from it in one load-bearing way.

**Keyed by group as well as by person and day.** The primary key is
`(org_id, user_id, day, surface)`. A chef can hold staff rows in two groups, and the owner of one
must never see their attendance in the other. `0060`'s table has no group to key by, so this is a
real difference and not the same table renamed. Getting this key wrong leaks between two
employers, which makes it the highest-risk line in the feature.

Carried over from `0060`, with its reasons, which that migration states at length:

- A row per day per surface, not a `last_seen_at` column: an overwritten timestamp can never
  answer "of the people who joined in September, how many still open it".
- The client's local date, not `current_date`, with the same `between current_date - 1 and
  current_date + 1` check constraint, and the same validation repeated inside the writer.
- A coarse surface name from a fixed list, never a route, validated in the function as well as the
  client, because the function is the real boundary.
- No select policy for anybody. The owner reads this through a definer function; a select policy
  would be a second copy of the role check that can drift from the one that enforces anything.
- Nothing stored on the device, so no consent banner, and `src/lib/browserStorage.test.ts` going
  red is the signal that something changed that.

Required by this repo's rules, each of which has a test that fails without it:

- `on delete cascade` on `user_id`, or the column is a veto on account deletion. Eight columns in
  this schema did exactly that, and `delete-account` blanks the profile first and removes the login
  last, so the refusal lands with the identity already erased.
- `on delete cascade` on `org_id`, so erasing a group (`0062`) takes its attendance with it.
- Its own `grant` in its own migration. `0039`'s schema-wide grant covers only what existed then,
  and without it every call fails `42501` while the policies read perfectly.
- `revoke execute ... from public, anon` on every new function, blanket-wise as `0049` does.

## The three readers that need no table

Every figure for questions 1 to 3 is a count or a date arithmetic over rows that exist today:
`orgs.created_at`, `sites.created_at` and `closed_at`, `dishes.created_at`, `stage`,
`trial_site_id` and `retired_at`, `dish_versions.created_at`, `approvals.approved_at`,
`published_snapshots.published_at` and `unpublished_at`, `deviations.created_at` with its
`site_id`, `staff.joined_at`, `staff_invites.created_at` and `used_at`.

## The read path, and the two ways it fails open

Two new `kitchen` functions, both `security definer`, `set search_path = kitchen, public`, both
with EXECUTE revoked from `public` and `anon`.

- **`kitchen.my_group_numbers()`**, no arguments, for the Dashboard strip. Returns one row per
  group where the caller is owner or chef, with block 1's three figures. Taking no argument is
  deliberate: there is no subject for a caller to substitute, which is the safest form of the rule
  in `supabase/rls.test.ts`.
- **`kitchen.group_numbers(p_org uuid)`**, for the page. It takes a uuid, so it must tie that uuid
  to the caller through `kitchen.staff_role(p_org)`, which `rls.test.ts` checks for.

**Both gates must be written positively.** `kitchen.staff_role()` is a bare select and returns
NULL for a non-member. `if role in ('owner','chef') then <return the numbers> end if` fails
closed. A negated form (`if role not in (...) then raise`) is NULL for a non-member, plpgsql skips
an `IF` body whose condition is NULL, and the refusal never fires: that is the exact shape that
let an offboarded user sign a dish onto a live menu, and `rls.test.ts` fails it. Use
`is distinct from` or `coalesce` wherever a negation is unavoidable.

**The owner-only block is a separate gate in the same function or its own function**, builder's
choice, but it must be a positive `role = 'owner'` test and must not be assembled client-side from
a payload that always contains it. A chef must not receive the per-person rows at all, not merely
fail to render them.

## Goals

- Four questions answered for a real group, by its owner, inside the app.
- The same definitions in the moderator console, aggregated across groups.
- No new storage for the three questions that need none.
- Every figure traceable to rows a reader is already entitled to, except the per-person attendance
  that the privacy page will now disclose.

## Non-goals

- A site-scoped view for a `site_manager` or anything at all for a `cook`.
- Charts. Lines of figures and short tables, in the existing `prose plate` idiom.
- Export, scheduled digests, or email.
- Any `signup_source` equivalent. The app is `noindex` and unlinked, so there is no acquisition to
  attribute.
- Costs, yields and allergens stay absent from this app, and no figure here may imply them.

## Anti-goals, the things that would make this a failure even if it worked

- **A fourth bridge migration.** This lives entirely inside the `kitchen` schema, and `admin` is
  already the one function allowed to read both. `supabase/kitchen_seal.test.ts` must stay green
  without its inventory being touched.
- **A vanity number.** A figure nobody can act on is a figure that should not be rendered. This is
  the same judgement that keeps follower counts out of the family app.
- **An owner reading attendance from another group.** The group-keyed primary key and the
  group-scoped read are both load-bearing against this.
- **A wall of zeros that reads as a fault.** The app has close to no traffic by design. Every
  surface must say why a figure is zero or absent, as the console's Kitchen section already does at
  the top of its block.
- **A gate that fails open.** See the read path above.

## Constraints

- All Supabase access through `src/lib/api/kitchen/`, which is the only thing the kitchen app may
  import from `src/lib/api/` besides `auth.ts`.
- Only class names `src/index.css` already defines. A missing class fails nothing and renders
  unstyled, which this app's shell shipped once.
- Verify with `npx tsc -b && npm test`; the migration also needs `npx supabase db reset`.
- The migration is applied to cloud BEFORE the frontend that needs it, and the `admin` function is
  redeployed by hand (`npx supabase functions deploy admin`). Neither happens automatically.
- `tests/integration/` is where a policy is proved correct rather than present. Set state up with
  the service role if you must, but never assert through it.

## Left to the builder

- The exact SQL shape of each figure, and whether the funnel is one query or several.
- Whether the owner-only block is a second function or a second gate inside one.
- Column and return-type names throughout.
- The surface list for `kitchen.activity_days`, drawn from the pages that exist.
- Where the write is called from, by analogy with the family app's layout-mount call.
- Copy, within the rule that every zero explains itself.

## One stale comment to fix while in here

`supabase/functions/admin/index.ts`, in `kitchen_insights`, says "The kitchen app is built but NOT
deployed, so every number here is usually 0". It has been live since 2026-10-12. `PRODUCT.md`
carried the same contradiction until 2026-10-18. The numbers are near zero because the app is
`noindex` and unlinked, which is a different claim, and the comment should say that instead.

## Definitions, settled after the builder check

A fresh pair of eyes read this document as the builder and asked what it had left ambiguous. These
are the answers. Where the answer was not already decided in the brainstorm it is **my call**,
marked as such, so it can be checked while reading rather than discovered during the build.

**What counts as started and landed** (my call). A dish is **started** when the `kitchen.dishes`
row exists, which is also what the console already counts, so the two cannot disagree. It has
**landed** when an `approvals` row exists for any of its versions. The median is measured from the
dish's FIRST version to its FIRST approval: `approvals` is keyed by `version_id`, so a dish revised
and re-approved has several, and the first one is the one that answers "did it land, and how long
did that take". A dish retired after approval still counts as landed, because it did.

**The funnel counts dishes in the app and groups in the console** (my call), and the steps are
nested so the drop-off arithmetic means something. Inside a group, the unit is the dish, because a
group looking at itself has one group and many dishes; the two group-level steps (the group exists,
a site was added) are therefore stated as context above the funnel rather than as its first two
bars. In the console the unit stays the ORG, which is what `kitchen_insights` already counts and
says it counts.

**Every figure is all-time** (my call), except the two that name their own window: attendance over
the last seven days, and "in development over a month", which is measured from the dish's first
version rather than from the dish row, since a dish with no version has not started being
developed. A group with twelve dishes has no thirty-day story, and a window would make the
headline figure move for reasons nobody did anything about. The console uses the same windows.

**Attendance history survives removal from staff** (my call). The rows are never deleted except by
the two cascades, so `activity_days` is read directly rather than through `staff`. The block is a
list of the group's CURRENT staff, so a removed person simply stops being listed: their history is
neither shown nor destroyed, and re-adding them shows it again.

**The write is group-scoped and lives in `OrgLayout`** (my call). The primary key contains
`org_id`, so a page that is not inside a group has no org to key by: "Your kitchens", `/orgs/new`,
the two documents and the auth pages record nothing. A chef working in two groups records a row in
whichever group they opened, which is the whole point of keying by group. It follows that a day in
the app but not in that group does not appear in that group's figures, and the page's copy must not
claim otherwise.

**The moderator console gets no per-person attendance.** Group-level figures only. A named person's
attendance is a kitchen ROW, and `kitchen_insights` exists to count kitchen rows and never to hand
one to a family user; that is what `supabase/kitchen_seal.test.ts` guards. The console may count how
many staff were active, and must not name them.

**A chef sees the Numbers page, not only the strip.** The nav item is shown, the page renders blocks
1 to 3, and block 4 is absent from the PAYLOAD rather than hidden in the markup. The route needs no
owner guard, because the only owner-only thing on it is a gate inside the read.

**A group with nothing yet** renders one short sentence in place of the strip's three figures, and
the same on the page. The anti-goal about a wall of zeros applies hardest here: the first thing
most groups will ever see of this feature is the empty state.

**The attendance denominator is days since joining**, Aayush's decision: "back 1 of 3 days since
joining" for someone who joined on Friday, rather than 1 of 7, so a new hire does not read as four
days absent. The seven-day window still bounds the figure for anyone who joined more than a week
ago, and the copy states the denominator rather than leaving it implied. **"Never opened it" is the
absence of any row**, a state of its own, not "0 of n days": somebody who joined yesterday and has
not arrived yet is not the same as somebody who stopped coming.

**The privacy sentence is drafted in the build and reviewed by Aayush**, his decision, with both
version constants bumped in the same change so nothing ships half-disclosed.
