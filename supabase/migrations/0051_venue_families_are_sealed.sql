-- 0051: venue families were joinable, and a comment said they were not.
--
-- THIS IS THE THIRD BRIDGE MIGRATION, and it is named in `supabase/kitchen_seal.test.ts`
-- alongside 0044 and 0045. The reason, written here as that test requires: the invariant
-- being enforced belongs to the kitchen side (a venue family must never gain a member),
-- but the only remaining way in is a function in the public schema. Enforcing it therefore
-- requires one place that can see both. The alternative, a stored `is_venue` flag on
-- public.families, keeps the schemas apart but introduces a flag that `publish_dish` must
-- remember to set and a backfill that must not be forgotten. A derived check cannot drift,
-- so the seal is widened by one file rather than the invariant being left to a convention.
--
-- WHAT WAS WRONG. 0044 creates a venue family in public.families the first time each dish
-- is published, and says it has "no member rows. Ever." 0047 then dropped the direct
-- insert policy on family_members and claimed in a comment that this made venue families
-- "unjoinable BY CONSTRUCTION". The 2026-10-12 audit reproduced the opposite, and the
-- comment in 0047 has been corrected:
--
--   - every families row gets a random invite_code by default (0001),
--   - families_member_read (0007) lets the row's CREATOR read it,
--   - the venue family's created_by is the publishing user,
--   - join_family_by_code is SECURITY DEFINER and had no venue exclusion.
--
-- So the publisher could read their own venue family's invite code and join it. Only that
-- one person could, and they already author the published recipe, so nothing crossed a
-- tenant boundary. It is fixed anyway because a comment asserting a guarantee the code does
-- not enforce is worse than no comment: the next control built on that invariant would be
-- unsound, and 0050 above is exactly such a control.
--
-- The refusal reuses the "invalid invite code" message on purpose. A distinct message would
-- turn this function into an oracle for which families are venues.

create or replace function join_family_by_code(p_code text) returns families
language plpgsql security definer set search_path = public as $$
declare
  fam families;
begin
  if auth.uid() is null then
    raise exception 'must be signed in to join a family';
  end if;
  select * into fam from families where invite_code = p_code;
  if fam.id is null then
    raise exception 'invalid invite code';
  end if;

  -- A venue family is a container for a published dish, not a household. Derived from the
  -- kitchen side rather than stored, so it cannot drift away from the truth.
  if exists (select 1 from kitchen.published_snapshots s where s.venue_family_id = fam.id) then
    raise exception 'invalid invite code';
  end if;

  -- BEFORE the insert. ensure_own_kitchen() RETURNS EARLY IF THE CALLER HAS ANY MEMBERSHIP,
  -- so called after, it would see the family just joined and do nothing. See 0038.
  perform ensure_own_kitchen();

  insert into family_members (family_id, user_id, role)
    values (fam.id, auth.uid(), 'member')
    on conflict (family_id, user_id) do nothing;
  return fam;
end; $$;

-- Any venue family that was already joined before this migration. There should be none in
-- practice, but the invariant is now enforced and the data should match it.
delete from family_members m
  where exists (select 1 from kitchen.published_snapshots s where s.venue_family_id = m.family_id);
