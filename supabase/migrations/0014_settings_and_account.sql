-- 0014: per-user settings, and an account that can be deleted without taking
-- the family's recipes with it.

-- Preferences travel with the person rather than the device: household size,
-- default tab, default plan length, preferred units. Deliberately jsonb and not
-- a column each, so adding the next preference needs no migration. Theme is NOT
-- stored here: it has to apply before the session loads or the page flashes the
-- wrong colours, so it lives in localStorage.
--
-- Note this is readable by co-members, because profiles_self_read lets family
-- members read each other's profiles. Nothing sensitive belongs in it.
alter table profiles add column preferences jsonb not null default '{}'::jsonb;

-- A profile now OUTLIVES its auth user.
--
-- Until now profiles.id referenced auth.users(id) on delete cascade, while
-- recipes.author_id references profiles(id) with no on-delete clause at all
-- (so: no action). Deleting an account therefore tried to cascade the profile
-- away and was then refused by the recipes that still pointed at it: account
-- deletion was impossible at the database level, whatever the UI did.
--
-- Dropping the foreign key makes the profile a durable authorship record
-- instead of a mirror of a login. Deleting the auth user leaves the profile
-- behind, so a recipe keeps its author, its comments and its provenance, and
-- the family vault survives the person leaving. That is the whole point of the
-- product: the recipes outlive the cook.
--
-- The trade-off, accepted deliberately: a profile row can now exist with no
-- auth user behind it. That is exactly what a deleted member IS. The delete
-- flow blanks the row's personal data (display_name becomes 'A former member',
-- avatar and preferences cleared) before removing the auth user, so what
-- remains carries no identity.
alter table profiles drop constraint profiles_id_fkey;
