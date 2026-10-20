# Deleting things in the professional kitchen app

Design, 2026-10-20. Decisions are Aayush's unless marked as my call.

## Why this exists

Nothing in the kitchen app can be removed. Not a dish, not a site, not a group. The cloud walk
on 2026-10-19 ended with a test group, two sites and two dishes sitting on production with no
button that could take them away, and removing them needs SQL.

Test clutter is the cheap half of the reason. The real one is in the kitchen privacy page: the
business, not us, is the controller of its dishes, versions and sign-offs. A controller that
cannot delete its own data is being promised something the app does not deliver. The same page
already says the delete gap is "a gap rather than a policy".

## The shape: two verbs, deliberately separate

Everyday tidying is reversible and low-stakes. Erasure is heavy, rare and owner-only. Most
people only ever touch the first. Keeping them apart is the whole design: one button that
sometimes destroys an audit trail is how an audit trail gets destroyed by accident.

| Verb | On what | Who | Reversible |
| --- | --- | --- | --- |
| Retire | a dish | chef or owner | yes, by un-retiring |
| Close | a site | owner | yes |
| Erase | a group, entirely | owner | no |

## The decisions

1. **Two verbs, not one.** A chef cleaning up a mistyped dish and a business leaving the
   product are not the same act and must not share a control.

2. **Erasing a group takes everything public down first, then clears the kitchen side.** It
   runs the existing take-down over every currently-published dish, so public exposure reaches
   zero, then removes the group's own records. **The dormant recipe rows in venue families are
   left in place.** Erasing those too is the honest meaning of the word and is the obvious next
   step, but it requires a function reaching from `kitchen` into `public`, which this repo
   treats as a fourth named bridge migration and a deliberate act. It waits for a concrete
   demand rather than being built on speculation. See Non-goals.

3. **Chefs and owners retire dishes. Owners alone close sites and erase groups.** The light
   verb sits where the work happens; anything destructive or public-facing stays with the
   owner. This needs no new concept: chefs and owners are already the pair the pipeline trusts
   to move a dish.

4. **Retirement and publication are separate axes, and neither blocks the other.** Retiring is
   about our menu; publishing is about the public. A seasonal dish comes off the menu and
   families keep the recipe.

   - Retire **blocks** `send_to_trial` and `sign_off`, the two actions that move a dish through
     the kitchen's own pipeline.
   - Retire **allows** revising, publishing and taking down.
   - **Retiring a currently-published dish is allowed**, and changes nothing the public sees.

   An earlier draft refused that, to stop a chef unpublishing as a side effect of tidying. That
   risk does not exist once retiring never touches the public, so the refusal was dropped
   rather than kept as a rule nobody could explain. The gain is one fewer refusal and a verb
   that works for the dish most likely to need it.

5. **A retired dish can be brought back by a chef or an owner**, through its own control beside
   the retired dish. The low stakes of retiring are the argument for letting the same people
   undo it.

6. **Closing a site clears the assignments of the staff scoped to it, cooks and site managers,
   and leaves chefs and owners alone.** Those two roles are the site-scoped ones, so leaving
   them pointed at a closed site is what would let somebody keep reading its trials and
   recording deviations against it. **The warning names both counts**: how many dishes return
   to development, and how many people lose a site.

7. **An owner may erase the group, but never while another owner exists.** The other owners
   have to be removed first, which makes leaving a deliberate path rather than one person
   ending it for everybody. Remaining chefs, site managers and cooks are cascaded, and the
   confirmation names how many people that is.

8. **Closing a site returns its trials to development**, in the same transaction. Nothing of
   record is lost, because only a sign-off creates a record and deviations already recorded at
   that site survive as history. The warning exists because the number is the damage, and a
   confirmation that does not say what it costs is decoration.

## Goals

- A chef can remove a dish they should not have created, without finding an owner.
- An owner can close a site the group no longer cooks at, and the app stays consistent.
- An owner can erase the group, and nothing of that group remains publicly visible afterwards.
- The test group left on production on 2026-10-19 can be removed through the app.

## Non-goals

- **Erasing the dormant recipe rows and venue families.** Deliberately deferred, per decision 2.
  The design should leave the seam obvious: an erase that later needs to reach into `public`
  should be an added step, not a rewrite.
- **Deleting or removing individual staff.** A separate question with its own privacy
  consequences, and the account-deletion path (`0059`) already covers a person leaving.
- **Undo for erasure.** It is defined as the irreversible verb; a reversible erasure is just
  archiving under a frightening name.
- **A moderation path to erase someone else's group.** Only the group's own owner.

## Anti-goals, which would make this a failure even if it worked

- **Public content nobody can remove.** The reason decision 2 unpublishes rather than leaving
  recipes public: a recipe whose group no longer exists has no owner left to take it down.
- **A chef changing what the public sees by side effect.** The reason decision 4 refuses.
- **Dangling references.** A dish naming a closed site, or a trial pinned to a site that is
  gone, reads as a bug every time somebody meets it.
- **An audit trail destroyed by a misclick.** Erasure must be unmistakable at the moment of use.

## Constraints the builder must respect

These are this repo's existing rules, and each has drawn blood before. `CLAUDE.md` holds the
full versions.

- **The kitchen schema is sealed from the family's.** Only `0044`, `0045` and `0051` bridge the
  two, and `supabase/kitchen_seal.test.ts` fails on any other migration that reaches across.
  **This work must not add a fourth.** Decision 2 is what keeps it out: erasure calls the
  existing take-down, which already lives on the bridge, rather than writing new cross-schema
  code.
- **`kitchen.unpublish_dish` (`0045`) is the take-down**, and it does not delete anything: it
  sets `public.recipes.visibility = 'family'` and stamps `unpublished_at` on the snapshot. The
  recipe then sits in a venue family that has no members, so nobody can see it. Reuse this
  function; do not reimplement its effect.
- **`dishes.trial_site_id` is `on delete set null`, and a check constraint requires
  `(stage = 'trial') = (trial_site_id is not null)`.** So a trial whose site disappears
  violates the constraint. Moving the dish out of `trial` is therefore mandatory and must
  happen in the same transaction as the close, not as a follow-up.
- **A new table in `kitchen` needs its own `grant`, in its own migration.** `0039`'s
  schema-wide grant only covered what existed then; without one, every call fails `42501` while
  the policies look perfect.
- **A new function in `kitchen` needs its EXECUTE revoked** from `public` and `anon`. `0049`
  revokes blanket-wise; confirm that covers anything added here.
- **Every `for update` and `for all` policy needs an explicit `with check`**, even when it
  repeats `using` word for word.
- **A `SECURITY DEFINER` function taking a `uuid` must tie it to `auth.uid()`.** Best here is to
  take the org id and check `staff_role` on it, never to trust an id as authority by itself.
- **A gate whose left side can be NULL is not a gate.** `kitchen.staff_role(org)` returns NULL
  for a non-member, and `NULL not in (...)` is NULL, which plpgsql skips. Write
  `coalesce(kitchen.staff_role(v_org), '') <> 'owner'`, or `is distinct from`. A negated test
  guarding a refusal fails OPEN, which is how offboarding once increased someone's authority.
- **A write refused by RLS is not an error.** Every write in `src/lib/api/` must `.select()`
  what it wrote and throw when nothing comes back, or go through an RPC that raises. Prefer the
  RPC here, since all three verbs need authority checks anyway.
- **A page must not render a control its viewer's policy will refuse.** Retire is offered to
  chefs and owners, close and erase to owners only.
- **Do not seed state from props that arrive later.** `f1767ba`, 2026-10-19: a `useState`
  initialised from a not-yet-loaded list left a control permanently disabled while the screen
  looked correct. Any new control with a list behind it derives its value on render.

## How, as far as it is decided

These are my calls, not Aayush's, and a builder with a better idea should take it.

- **Retire is `retired_at timestamptz null` on `kitchen.dishes`**, not a new `dish_stage` value.
  The enum drives the trial check constraint and the read ladder in `0041`; adding a member
  means revisiting both, and retirement is orthogonal to where a dish sits in the pipeline.
- **Close is `closed_at timestamptz null` on `kitchen.sites`.** A flag rather than a row
  deletion means the `on delete set null` path is never taken and deviations recorded at that
  site keep naming it.
- **Each verb is an RPC in the `kitchen` schema**, taking the org or the row it acts on,
  checking `staff_role` with a `coalesce`d gate, and raising on refusal with the `KIT01`/`KIT04`
  codes `0049` already uses.
- **Erase removes the `kitchen.orgs` row** after unpublishing, and lets existing cascades clear
  sites, staff, dishes, versions, sign-offs and deviations. **The builder must verify that
  cascade coverage is real** rather than assuming it: `dishes.org_id` is
  `on delete cascade`, and the rest need checking one table at a time.

## Settled by me, after a builder's review of this document

These came out of a fresh reader planning the build. Each is my call, not Aayush's, and is
written here so the builder does not have to guess the same way twice.

- **Erase skips dishes already taken down.** `unpublish_dish` raises `KIT04` when
  `unpublished_at` is already set, so looping it over every snapshot would abort an erase
  halfway, with some dishes down and the group still present. Erase takes only live snapshots.
- **The kitchen privacy page is part of this work.** It currently says "There is no delete
  button in this app yet, which is a gap rather than a policy", which ships false on the day
  this lands. The page changes with the feature, `KITCHEN_PRIVACY_UPDATED` in `src/lib/legal.ts`
  moves, and whatever test fingerprints it has to go green on the new wording. Check `Terms.tsx`
  for the same claim while there.
- **Two migrations, not one.** `kitchen_retire_and_close` then `kitchen_erase`, matching this
  repo's one-concern-per-file convention. Neither may touch `public`; the seal test is the
  proof.
- **Error codes.** `KIT01` for a wrong role (close or erase as a non-owner, retire as a cook).
  `KIT02` for a wrong state (send to trial or sign off a retired dish, erase while another
  owner exists). `KIT04` for a row that is not there.
- **Erase is not idempotent and does not pretend to be.** A second call raises `KIT04`, because
  the group is gone. The frontend navigates away on success, so the second press is a race, not
  a workflow.
- **The close warning's count is dishes currently at trial at that site**, which is exactly the
  set whose stage changes. The people count is cooks and site managers assigned to that site.
- **The frontend reads both counts before closing**, through an ordinary query rather than a
  dry-run flag on the RPC. A confirmation needs the numbers before the act, and an RPC that
  sometimes does nothing is a worse shape than a read followed by a write.
- **A retired dish stays readable and reachable by URL** to anyone who could read it before.
  Hiding it from a list is presentation; changing who may read it is a policy change, and this
  work does not make one.
- **The builder may add a route and a nav item** for wherever erase lives.
  `src/kitchen/routes.terms.test.tsx` requires any new action route to sit inside the gated
  band, and that test is the check.
- **A group whose last owner deleted their account cannot be erased through the app.** The
  non-goals already rule out a moderation path, so that case stays an operator's job in SQL.

## What is left to the builder

- Where the erase control lives. There is no group settings screen today, and inventing one is
  part of the job.
- Whether retired dishes vanish from the list entirely or sit behind a "show retired" toggle.
- The exact confirmation mechanism for erasure, beyond the requirement that it states what will
  be destroyed and cannot be triggered by a single stray click.
- The wording of all three confirmations, including the dish count in the close warning.

## Verifying it

- `npx tsc -b && npm test`, and `npx supabase db reset` for the migration.
- `supabase/rls.test.ts` and `supabase/kitchen_seal.test.ts` must stay green; the seal test is
  the one that proves no fourth bridge appeared.
- An integration test under `tests/integration/` that performs each verb as an ordinary user,
  and attempts each as a role that should be refused. A static check proves a policy exists,
  never that it is correct, and the service role bypasses RLS so nothing may be asserted
  through it.
- A browser walk on a real database: retire a dish as a chef, be refused on a published one,
  close a site holding a trial and see the count in the warning, then erase a group and confirm
  the published recipe is no longer public.
- **Migration to cloud BEFORE the frontend that needs it.**
