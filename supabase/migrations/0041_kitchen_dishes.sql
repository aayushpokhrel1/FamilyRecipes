-- 0041: a dish, its immutable versions, and the ladder that decides who may read it.
--
-- The stage lives on the DISH and the sign-off lives on the VERSION (0042). If stage lived
-- on versions, "what is on the menu" could not be answered; if sign-off lived on the dish,
-- you could not tell WHICH version was approved.
--
-- Ingredients and steps hang off a VERSION, never off the dish, and there is deliberately no
-- update or delete policy on any of the three. Revising writes a new version. That is the
-- whole product: a Google Doc cannot tell you who changed what and why.
create type kitchen.dish_stage as enum ('development','trial','menu');

create table kitchen.dishes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references kitchen.orgs(id) on delete cascade,
  title text not null,
  stage kitchen.dish_stage not null default 'development',
  trial_site_id uuid references kitchen.sites(id) on delete set null,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  -- A dish at trial must name the site it is out at, and a dish anywhere else must not. The
  -- read ladder below keys on trial_site_id, so a trial with a null site would be readable
  -- by nobody and a menu dish with a stale site would read as a trial.
  constraint trial_site_iff_trial check (
    (stage = 'trial') = (trial_site_id is not null))
);

create table kitchen.dish_versions (
  id uuid primary key default gen_random_uuid(),
  dish_id uuid not null references kitchen.dishes(id) on delete cascade,
  n int not null,
  note text,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique (dish_id, n)
);

create table kitchen.dish_ingredients (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null references kitchen.dish_versions(id) on delete cascade,
  position int not null,
  quantity text, unit text, item text not null, section text
);

create table kitchen.dish_steps (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null references kitchen.dish_versions(id) on delete cascade,
  position int not null,
  text text not null
);

-- ONE home for the ladder. Every policy below calls this, so changing the rule here changes
-- it everywhere, which is the lesson from the muted-cook filter that lived in one query path
-- and was ignored by the other.
--
-- A site_manager or cook with site_id null belongs to NO site, so the trial clause cannot
-- match for them and they see nothing until the dish reaches the menu. Strict on purpose.
create function kitchen.can_read_dish(p_dish uuid) returns boolean
language sql stable security definer set search_path = kitchen, public as $$
  select exists (
    select 1
    from kitchen.dishes d
    join kitchen.staff s on s.org_id = d.org_id and s.user_id = auth.uid()
    where d.id = p_dish
      and (
        d.stage = 'menu'
        or s.role in ('owner','chef')
        or (d.stage = 'trial' and s.site_id is not null and s.site_id = d.trial_site_id)
      ));
$$;

alter table kitchen.dishes enable row level security;
alter table kitchen.dish_versions enable row level security;
alter table kitchen.dish_ingredients enable row level security;
alter table kitchen.dish_steps enable row level security;

create policy dishes_read on kitchen.dishes for select using (kitchen.can_read_dish(id));
create policy versions_read on kitchen.dish_versions for select
  using (kitchen.can_read_dish(dish_id));
create policy ingredients_read on kitchen.dish_ingredients for select using (exists (
  select 1 from kitchen.dish_versions v
  where v.id = version_id and kitchen.can_read_dish(v.dish_id)));
create policy steps_read on kitchen.dish_steps for select using (exists (
  select 1 from kitchen.dish_versions v
  where v.id = version_id and kitchen.can_read_dish(v.dish_id)));

grant select, insert, update, delete on kitchen.dishes to authenticated, service_role;
grant select, insert, update, delete on kitchen.dish_versions to authenticated, service_role;
grant select, insert, update, delete on kitchen.dish_ingredients to authenticated, service_role;
grant select, insert, update, delete on kitchen.dish_steps to authenticated, service_role;

create function kitchen.create_dish(p_org uuid, p_title text) returns uuid
language plpgsql security definer set search_path = kitchen, public as $$
declare v_dish uuid;
begin
  if kitchen.staff_role(p_org) not in ('owner','chef') then
    raise exception 'only an owner or a chef may start a dish' using errcode = 'KIT01';
  end if;
  insert into kitchen.dishes (org_id, title, created_by)
    values (p_org, p_title, auth.uid()) returning id into v_dish;
  return v_dish;
end; $$;

-- A version and its children are written in ONE statement sequence inside one function, for
-- the same reason replace_recipe_children exists on the family side: a half-written version
-- is a dish somebody cooks wrongly.
create function kitchen.revise_dish(
  p_dish uuid, p_note text, p_ingredients jsonb, p_steps jsonb) returns uuid
language plpgsql security definer set search_path = kitchen, public as $$
declare v_org uuid; v_n int; v_version uuid;
begin
  select org_id into v_org from kitchen.dishes where id = p_dish;
  if v_org is null then
    raise exception 'no such dish' using errcode = 'KIT04';
  end if;
  if kitchen.staff_role(v_org) not in ('owner','chef') then
    raise exception 'only an owner or a chef may revise a dish' using errcode = 'KIT01';
  end if;

  select coalesce(max(n), 0) + 1 into v_n from kitchen.dish_versions where dish_id = p_dish;
  insert into kitchen.dish_versions (dish_id, n, note, created_by)
    values (p_dish, v_n, p_note, auth.uid()) returning id into v_version;

  insert into kitchen.dish_ingredients (version_id, position, quantity, unit, item, section)
  select v_version, (e->>'position')::int, e->>'quantity', e->>'unit', e->>'item', e->>'section'
  from jsonb_array_elements(coalesce(p_ingredients, '[]'::jsonb)) e;

  insert into kitchen.dish_steps (version_id, position, text)
  select v_version, (e->>'position')::int, e->>'text'
  from jsonb_array_elements(coalesce(p_steps, '[]'::jsonb)) e;

  return v_version;
end; $$;
