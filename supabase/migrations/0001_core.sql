-- pgcrypto provides gen_random_bytes (invite codes). Supabase keeps extensions in
-- the `extensions` schema, which is not on the migration role's search_path on the
-- cloud, so enable it there and call it schema-qualified below.
create extension if not exists pgcrypto with schema extensions;

-- profiles: one per auth user
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default 'Cook',
  avatar_url text,
  created_at timestamptz not null default now()
);

-- auto-create a profile when an auth user is created
create function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', 'Cook'));
  return new;
end; $$;
create trigger on_auth_user_created
  after insert on auth.users for each row execute function handle_new_user();

create table families (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_by uuid not null references profiles(id),
  invite_code text not null unique default encode(extensions.gen_random_bytes(6), 'hex'),
  created_at timestamptz not null default now()
);

create table family_members (
  family_id uuid not null references families(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  role text not null default 'member' check (role in ('owner','member')),
  joined_at timestamptz not null default now(),
  primary key (family_id, user_id)
);

-- membership helper used by RLS on other tables
create function is_family_member(fid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from family_members
    where family_id = fid and user_id = auth.uid()
  );
$$;
