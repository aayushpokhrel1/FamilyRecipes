-- 0059: the kitchen schema could veto account deletion, and the last owner could strand an org.
--
-- TWO findings from the kitchen coverage unit, both in what a row MEANS once the person
-- behind it is gone.
--
-- 1. EIGHT ATTRIBUTION COLUMNS HERE POINT AT auth.users WITH NO ON DELETE ACTION, which is
--    NO ACTION, so Postgres refuses to remove the login while any one of those rows exists.
--    Neither deletion path (`delete-account` for the person themselves, `admin`'s delete_user
--    for a moderator) touches this schema, and both call auth.admin.deleteUser LAST, AFTER
--    blanking the profile. So for anybody who had ever started an org, written a dish version,
--    signed one off, recorded a deviation, published a dish, or minted or accepted an invite,
--    deletion failed at the final step and left the worst state available: identity blanked,
--    login still live, and a 500 telling the person it had not worked. `src/pages/Privacy.tsx`
--    promises erasure, so until now that page was false for every kitchen user.
--
--    `set null` rather than cascade, in every case. The group keeps its dish, its versions and
--    its deviation history, because other people are cooking from them, and the person stops
--    being named in any of it. That is the same answer the family side already gives a recipe
--    (0014): the content survives, the identity does not.
--
--    `deletion_parity.test.ts` could not see this: it compares the two deletion paths with
--    each other, and they agreed. `supabase/kitchen_deletion.test.ts` is the new mechanical
--    guard, and it reads the migrations rather than this list, so the ninth column nobody has
--    written yet is covered too.
--
-- 2. THE LAST OWNER COULD DELETE THEIR OWN STAFF ROW. `staff_delete` says a member may leave
--    and an owner may remove anyone, and 0039's own comment next to create_org says an org and
--    its owner row must appear together "or the org can be administered by nobody". Leaving was
--    the door to exactly that state: every remaining act in this schema (add_site, create_dish,
--    create_invite, publish_dish, unpublish_dish, renaming the org) is owner-gated and
--    fail-closed, so an org with no owner is permanently frozen, and a dish of its already
--    published to Potluck can never be taken down again. A departing owner may remove the other
--    owners first, so this is reachable by somebody being offboarded, which is the direction
--    0049 and 0054 were both about: leaving must not increase what you can do to the place.
--
--    Deleting the LOGIN still strands the org, through the `on delete cascade` on
--    staff.user_id, and that is deliberate: erasure wins over an invariant. This closes the
--    door that is a choice rather than a right.

alter table kitchen.orgs alter column created_by drop not null;
alter table kitchen.orgs drop constraint orgs_created_by_fkey,
  add constraint orgs_created_by_fkey foreign key (created_by)
    references auth.users(id) on delete set null;

-- created_by here is load-bearing, not decoration: 0054's accept_invite refuses an invite
-- whose sender is no longer an owner, with a positive `exists` test. Nulling it makes that
-- test fail to find an owner row, so the invite dies with its sender's account, which is the
-- answer 0054 wanted anyway.
alter table kitchen.staff_invites alter column created_by drop not null;
alter table kitchen.staff_invites drop constraint staff_invites_created_by_fkey,
  add constraint staff_invites_created_by_fkey foreign key (created_by)
    references auth.users(id) on delete set null;
alter table kitchen.staff_invites drop constraint staff_invites_used_by_fkey,
  add constraint staff_invites_used_by_fkey foreign key (used_by)
    references auth.users(id) on delete set null;

alter table kitchen.dishes alter column created_by drop not null;
alter table kitchen.dishes drop constraint dishes_created_by_fkey,
  add constraint dishes_created_by_fkey foreign key (created_by)
    references auth.users(id) on delete set null;

alter table kitchen.dish_versions alter column created_by drop not null;
alter table kitchen.dish_versions drop constraint dish_versions_created_by_fkey,
  add constraint dish_versions_created_by_fkey foreign key (created_by)
    references auth.users(id) on delete set null;

alter table kitchen.approvals alter column approved_by drop not null;
alter table kitchen.approvals drop constraint approvals_approved_by_fkey,
  add constraint approvals_approved_by_fkey foreign key (approved_by)
    references auth.users(id) on delete set null;

alter table kitchen.deviations alter column created_by drop not null;
alter table kitchen.deviations drop constraint deviations_created_by_fkey,
  add constraint deviations_created_by_fkey foreign key (created_by)
    references auth.users(id) on delete set null;

alter table kitchen.published_snapshots alter column published_by drop not null;
alter table kitchen.published_snapshots drop constraint published_snapshots_published_by_fkey,
  add constraint published_snapshots_published_by_fkey foreign key (published_by)
    references auth.users(id) on delete set null;

-- RESTATED IN FULL from 0039, with the last-owner clause added. A DELETE policy has no
-- `with check`, so the whole rule is the `using` clause.
drop policy staff_delete on kitchen.staff;
create policy staff_delete on kitchen.staff for delete using (
  (user_id = auth.uid() or kitchen.staff_role(org_id) = 'owner')
  -- An owner row may only go while another owner remains. Written as a positive `exists` on
  -- the OTHER rows, so the clause is false rather than NULL for the row that is the only
  -- owner: a NULL here would be a refusal that depends on how Postgres combines it, and
  -- 0049 is in this repo because a NULL in a gate is not a gate.
  and (
    role <> 'owner'
    or exists (
      select 1 from kitchen.staff other
      where other.org_id = staff.org_id
        and other.role = 'owner'
        and other.user_id <> staff.user_id)
  ));
