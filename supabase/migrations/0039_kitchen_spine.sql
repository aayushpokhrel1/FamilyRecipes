-- 0039: the professional kitchen's own schema.
--
-- Spec: docs/superpowers/specs/2026-10-11-professional-kitchen-design.md
--
-- This schema is SEALED from `public` on purpose: a restaurant group's data and a family's
-- data never touch, and that seal is the entire reason the kitchen is a second app rather
-- than a workspace type inside this one. Nothing here references public.families,
-- public.recipes or public.profiles. Staff reference auth.users directly, and a chef's
-- professional name lives on their staff row rather than being borrowed from a family
-- profile. The ONE crossing is the publish bridge, which lives alone in 0040 so there is a
-- single file to read to see every crossing.
create schema kitchen;

-- A NEW SCHEMA IS GRANTED TO NOBODY. Supabase grants `public` to anon and authenticated for
-- you; it does not do that here. A table with perfect policies and no grant fails every call
-- with a permission error, which looks nothing like an RLS problem while you debug it.
-- The grant at the END of this file covers every table created above it. ANY NEW KITCHEN
-- TABLE IN A LATER MIGRATION MUST REPEAT THAT GRANT IN ITS OWN FILE; supabase/rls.test.ts
-- fails if it does not.
-- service_role as well as authenticated. service_role BYPASSES RLS but it does not bypass
-- grants, so without this the key that edge functions and the integration tests use reads an
-- empty table rather than an error, which is the worst possible failure: a test that asserts
-- "the stranger sees nothing" passes for the wrong reason. Supabase grants both roles on
-- `public` for you. It grants nobody anything here.
grant usage on schema kitchen to authenticated, service_role;

create table kitchen.orgs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create table kitchen.sites (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references kitchen.orgs(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);

-- site_id null means GROUP-WIDE. For an owner or a chef that is the normal case. For a
-- site_manager or a cook it means they belong to no site, so the trial-stage rule below can
-- never match for them, and they read nothing until a dish reaches the menu. That is strict
-- on purpose: the alternative is guessing which site a cook belongs to.
create table kitchen.staff (
  org_id uuid not null references kitchen.orgs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner','chef','site_manager','cook')),
  site_id uuid references kitchen.sites(id) on delete set null,
  display_name text not null,
  joined_at timestamptz not null default now(),
  primary key (org_id, user_id)
);

-- Three helpers, each with ONE home, because a rule that lives in two places is how
-- this project has been bitten before. security definer because staff_read requires staff, so an
-- invoker-rights lookup of your own membership would be circular; search_path is pinned so
-- those definer rights cannot be redirected at a table in another schema.
create function kitchen.is_staff(p_org uuid) returns boolean
language sql stable security definer set search_path = kitchen, public as $$
  select exists (
    select 1 from kitchen.staff where org_id = p_org and user_id = auth.uid());
$$;

create function kitchen.staff_role(p_org uuid) returns text
language sql stable security definer set search_path = kitchen, public as $$
  select role from kitchen.staff where org_id = p_org and user_id = auth.uid();
$$;

create function kitchen.staff_site(p_org uuid) returns uuid
language sql stable security definer set search_path = kitchen, public as $$
  select site_id from kitchen.staff where org_id = p_org and user_id = auth.uid();
$$;

alter table kitchen.orgs enable row level security;
alter table kitchen.sites enable row level security;
alter table kitchen.staff enable row level security;

-- Reads: staff of the org, and nobody else. There is deliberately NO insert policy on orgs
-- or staff: an org and its owner row must appear together or not at all, so the only door is
-- create_org below. 0038 moved exactly this kind of invariant out of the client after a link
-- joined a family before the client-side check had run.
create policy orgs_staff_read on kitchen.orgs for select using (kitchen.is_staff(id));
create policy orgs_owner_update on kitchen.orgs for update
  using (kitchen.staff_role(id) = 'owner');

create policy sites_staff_read on kitchen.sites for select using (kitchen.is_staff(org_id));

create policy staff_read on kitchen.staff for select using (kitchen.is_staff(org_id));
-- A member may leave; an owner may remove anyone.
create policy staff_delete on kitchen.staff for delete using (
  user_id = auth.uid() or kitchen.staff_role(org_id) = 'owner');

create function kitchen.create_org(p_name text, p_display_name text) returns uuid
language plpgsql security definer set search_path = kitchen, public as $$
declare v_org uuid;
begin
  if auth.uid() is null then
    raise exception 'sign in first' using errcode = 'KIT01';
  end if;
  insert into kitchen.orgs (name, created_by) values (p_name, auth.uid()) returning id into v_org;
  insert into kitchen.staff (org_id, user_id, role, display_name)
    values (v_org, auth.uid(), 'owner', coalesce(nullif(btrim(p_display_name), ''), 'Chef'));
  return v_org;
end; $$;

create function kitchen.add_site(p_org uuid, p_name text) returns uuid
language plpgsql security definer set search_path = kitchen, public as $$
declare v_site uuid;
begin
  if kitchen.staff_role(p_org) is distinct from 'owner' then
    raise exception 'only an owner may add a site' using errcode = 'KIT01';
  end if;
  insert into kitchen.sites (org_id, name) values (p_org, p_name) returning id into v_site;
  return v_site;
end; $$;

grant select, insert, update, delete on all tables in schema kitchen to authenticated, service_role;
grant execute on all functions in schema kitchen to authenticated, service_role;
