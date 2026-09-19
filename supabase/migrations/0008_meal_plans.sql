-- My Kitchen: personal meal plans + derived grocery list.
create table meal_plans (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references profiles(id),
  family_id uuid not null references families(id) on delete cascade,
  name text not null,
  view_mode text not null default 'list' check (view_mode in ('list','calendar')),
  is_shared boolean not null default false,
  checked_items text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table meal_plan_items (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references meal_plans(id) on delete cascade,
  recipe_id uuid not null references recipes(id) on delete cascade,
  day date,
  meal_slot text check (meal_slot in ('breakfast','lunch','dinner')),
  position int not null default 0,
  unique (plan_id, recipe_id, day, meal_slot)
);
create table meal_plan_manual_items (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references meal_plans(id) on delete cascade,
  label text not null,
  position int not null default 0
);

-- readability predicate reused by the child tables' select policies
create function can_read_plan(pid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from meal_plans p where p.id = pid and (
    p.owner_id = auth.uid()
    or (p.is_shared and is_family_member(p.family_id))
  ));
$$;

alter table meal_plans enable row level security;
alter table meal_plan_items enable row level security;
alter table meal_plan_manual_items enable row level security;

-- plans: owner sees own; family members see shared ones. Owner-only writes.
-- insert sets owner_id = auth.uid(), so the insert().select() RETURNING passes
-- the select policy (no 0007-style creator-read bug here).
create policy plans_read on meal_plans for select using (
  owner_id = auth.uid() or (is_shared and is_family_member(family_id)));
create policy plans_insert on meal_plans for insert with check (
  owner_id = auth.uid() and is_family_member(family_id));
create policy plans_update on meal_plans for update using (owner_id = auth.uid());
create policy plans_delete on meal_plans for delete using (owner_id = auth.uid());

-- child rows: readable if parent readable; writable only by the plan owner
create policy plan_items_read on meal_plan_items for select using (can_read_plan(plan_id));
create policy plan_items_write on meal_plan_items for all using (
  exists (select 1 from meal_plans p where p.id = plan_id and p.owner_id = auth.uid()))
  with check (
  exists (select 1 from meal_plans p where p.id = plan_id and p.owner_id = auth.uid()));

create policy manual_items_read on meal_plan_manual_items for select using (can_read_plan(plan_id));
create policy manual_items_write on meal_plan_manual_items for all using (
  exists (select 1 from meal_plans p where p.id = plan_id and p.owner_id = auth.uid()))
  with check (
  exists (select 1 from meal_plans p where p.id = plan_id and p.owner_id = auth.uid()));
