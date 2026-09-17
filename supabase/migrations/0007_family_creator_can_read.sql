-- createFamily does insert(...).select(): the RETURNING that .select() adds makes
-- Postgres apply the SELECT policy to the just-inserted row. families_member_read
-- required membership, but the creator's owner row is inserted only afterwards, so
-- the creator could not read their own brand-new family and the insert failed with
-- a row-level security violation. Let the creator read the family too (created_by is
-- a permanent ownership link), which also unblocks the insert().select() round trip.
drop policy families_member_read on families;
create policy families_member_read on families for select
  using (is_family_member(id) or created_by = auth.uid());
