-- 0062: an owner can erase a group.
--
-- ERASING A GROUP IS NOT THE SAME ACT AS TAKING ITS DISHES DOWN, and this file keeps the two
-- in the right order rather than conflating them. A group that is erased stops existing in the
-- kitchen: its sites, staff, invites, dishes, versions, ingredients, steps, sign-offs,
-- deviations and snapshots all go, because the cascades already say so. What does NOT go is
-- the public page: a recipe somebody already linked to survives on purpose, and only its
-- PUBLICITY ends. That is why every still-published dish is taken down first, through
-- `kitchen.unpublish_dish`, before the org row is deleted.
--
-- THE `unpublished_at is null` FILTER IS THE WHOLE POINT OF THAT LOOP. `unpublish_dish` RAISES
-- `KIT04` when a dish is already taken down, so a loop over every snapshot would abort the
-- erase halfway: some dishes down, the group still standing, and the owner with no way to
-- tell how far it got. A dish whose snapshot is already stamped is skipped, never called.
--
-- THE CASCADE ORDER IS NOT OURS TO CHOOSE. `published_snapshots.version_id` references
-- `kitchen.dish_versions` with NO on-delete action, so if the snapshots were not cleared
-- before the versions the delete would be refused outright. Deleting the org row and letting
-- the existing cascades run is what makes that work; nothing is deleted by hand here.
--
-- THIS IS NOT A BRIDGE MIGRATION. It contains no reference to the `public` schema except the
-- `search_path` setting. It reaches the family app ONLY by calling `kitchen.unpublish_dish`,
-- which already lives on an approved bridge (0045). supabase/kitchen_seal.test.ts names only
-- 0044, 0045 and 0051 as bridges and fails any other file that touches `public.` directly.
-- Deleting the dormant venue-family rows is deliberately DEFERRED: those rows live in the
-- family app, and removing them would require a fourth bridge, which is a decision for its
-- own migration rather than a side effect of this one.

-- Owner only, and only when they are the LAST owner. Erasing a group is a decision about the
-- business, and a group with two owners is a group where somebody else still has a stake in
-- it; the second owner has to be removed first, deliberately, by a person.
--
-- `coalesce` is mandatory on the gate below, not stylistic. `kitchen.staff_role(org)` is a
-- bare SELECT, so it returns NULL for a caller with no staff row, and `NULL <> 'owner'` is
-- NULL, which plpgsql skips. A bare comparison would therefore refuse every wrong role and
-- admit the absence of a role, which is the HIGH 0049 was written for. supabase/rls.test.ts
-- fails the build on that shape.
create function kitchen.erase_org(p_org uuid) returns void
language plpgsql security definer set search_path = kitchen, public as $$
declare v_dish uuid;
begin
  if not exists (select 1 from kitchen.orgs where id = p_org) then
    raise exception 'no such group' using errcode = 'KIT04';
  end if;
  if coalesce(kitchen.staff_role(p_org), '') <> 'owner' then
    raise exception 'only an owner may erase a group' using errcode = 'KIT01';
  end if;
  if exists (select 1 from kitchen.staff
              where org_id = p_org and role = 'owner' and user_id <> auth.uid()) then
    raise exception 'remove the other owners first' using errcode = 'KIT02';
  end if;
  -- Take down everything still public, skipping anything already taken down. Calling
  -- unpublish_dish on a stamped snapshot raises KIT04 and would abort the erase halfway.
  for v_dish in
    select d.id from kitchen.dishes d
      join kitchen.published_snapshots s on s.dish_id = d.id
     where d.org_id = p_org and s.unpublished_at is null
  loop
    perform kitchen.unpublish_dish(v_dish);
  end loop;
  -- The cascades clear sites, staff, invites, dishes, versions, ingredients, steps,
  -- sign-offs, deviations and snapshots. Nothing is deleted by hand.
  delete from kitchen.orgs where id = p_org;
end; $$;

-- THE BLANKET FORM IS REQUIRED, NOT OPTIONAL. 0039 and 0049 each granted only the functions
-- that existed WHEN THEY RAN, so every function added since kept Postgres's default of
-- EXECUTE to PUBLIC while anon holds USAGE on the schema. That is exactly how the 0049
-- vulnerability became reachable at all. A blanket revoke is the only form that also covers
-- the function nobody has written yet. `peek_invite` is granted back to anon deliberately:
-- an invite link has to say which kitchen it is for before the person signs in.
revoke execute on all functions in schema kitchen from public, anon;
grant execute on all functions in schema kitchen to authenticated, service_role;
grant execute on function kitchen.peek_invite(text) to anon;
