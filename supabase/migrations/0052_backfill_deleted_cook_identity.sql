-- 0052: erase the public identity of accounts that were already self-deleted.
--
-- The code fix is in supabase/functions/delete-account/index.ts, which now blanks the same
-- columns the moderator path does. This migration cleans up the rows that path already
-- left behind, because a fix that only applies going forward leaves the people who asked
-- for erasure still listed.
--
-- WHY THOSE ROWS SURVIVE AT ALL. Migration 0014 dropped the foreign key from profiles to
-- auth.users so a deleted cook's recipes keep a row to point at. Its comment recorded that
-- the deletion flow leaves "no identity", which was true then: the table had four columns.
-- 0020 added handle, public_name and bio, and only the moderator path was ever updated.
-- public_cooks selects `where handle is not null`, so a self-deleted cook stayed listed,
-- /cooks/<handle> kept serving their name and bio, and the sitemap kept offering it to
-- crawlers. src/pages/Privacy.tsx promises the opposite.
--
-- Identified by the absence of the auth.users row rather than by a tombstone column: the
-- login is gone for exactly the accounts that were deleted, by either path, and that is
-- true however the display_name was worded at the time.
--
-- `supabase/deletion_parity.test.ts` now fails if the two deletion paths ever blank
-- different column sets again, and fails if either leaves a column that public_cooks
-- exposes. That is the guard; this is the cleanup.

update profiles
   set handle = null,
       public_name = null,
       bio = null,
       avatar_url = null
 where not exists (select 1 from auth.users u where u.id = profiles.id)
   and (handle is not null or public_name is not null or bio is not null
        or avatar_url is not null);
