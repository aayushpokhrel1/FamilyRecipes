-- 0020: a public identity for a cook, and the two narrow views that are the ONLY way an
-- anonymous stranger can read anything out of profiles or families.

-- handle IS the opt-in: null means "I do not publish". A separate boolean could disagree
-- with it, this cannot. Stored lowercase, which the check enforces, so case-insensitive
-- uniqueness needs neither citext nor a functional index.
alter table profiles
  add column handle text unique
    check (handle is null or handle ~ '^[a-z0-9_]{3,30}$'),
  add column public_name text,
  add column bio text;

-- SECURITY DEFINER BY DEFAULT (security_invoker is off unless asked for), AND DELIBERATELY
-- SO. anon has no policy on profiles and must never get one: RLS is row-level, so a policy
-- exposing a published cook's row would expose display_name and preferences with it.
-- This view is the ONLY public path into profiles. The explicit column list is the column
-- gate and `handle is not null` is the row gate.
-- NEVER write select * here, and never add a column without deciding it is public.
-- avatar_url is a storage PATH, not a URL, and is useless without the avatars policy in 0022.
create view public_cooks as
  select id, handle, public_name, bio, avatar_url
  from profiles
  where handle is not null;

grant select on public_cooks to anon, authenticated;

-- Same reasoning for the byline: families is member-only, so a stranger cannot read the
-- family name off a public recipe without a narrow path to it.
-- The left join is deliberate: a recipe can be public while its author has not claimed a
-- handle, and that must render as the family name alone rather than break the page. The UI
-- requires a handle before publishing, but the database must not assume the UI is the only
-- writer.
create view public_recipe_bylines as
  select r.id as recipe_id, p.handle, p.public_name, f.name as family_name
  from recipes r
  join families f on f.id = r.family_id
  left join profiles p on p.id = r.author_id and p.handle is not null
  where r.visibility = 'public';

grant select on public_recipe_bylines to anon, authenticated;
