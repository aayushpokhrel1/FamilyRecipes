-- 0012: a plan can own a stretch of dates; one cook event can fill several
-- slots; a family can record the staples it always keeps in.
--
-- Additive only. Every column is nullable or defaulted, so the deployed
-- frontend keeps working against this schema before its rebuild lands.

alter table meal_plans add column start_date date;
alter table meal_plans add column length_days int not null default 7
  check (length_days between 1 and 31);

-- A leftover points at the item whose pot it came from. Cascade on delete: a
-- leftover of a deleted meal is a lie. Rows with leftover_of set contribute no
-- ingredients to the grocery list (filtered in getGroceryList).
alter table meal_plan_items add column leftover_of uuid
  references meal_plan_items(id) on delete cascade;

create table pantry_staples (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references families(id) on delete cascade,
  key text not null,   -- normalizeItem() output, so "all-purpose flour" matches "flour"
  label text not null, -- what the user typed, for display
  unique (family_id, key)
);

-- One household, one cupboard: staples are family-scoped, like recipes.
alter table pantry_staples enable row level security;
create policy staples_read on pantry_staples for select
  using (is_family_member(family_id));
create policy staples_write on pantry_staples for all
  using (is_family_member(family_id)) with check (is_family_member(family_id));

-- Clone a plan and its items, shifting every dated item by the gap between the
-- old and new start, and repointing leftovers at the clones.
--
-- SECURITY INVOKER: the caller's own RLS decides what they may read and insert,
-- exactly as a client-side clone would, so this adds no privilege.
--
-- The loop is deliberate. Doing this set-at-once needs an old-id to new-id map
-- that INSERT ... RETURNING cannot produce, and item counts here are tens, not
-- thousands. Sources are cloned before leftovers (the ORDER BY puts
-- leftover_of IS NULL first) so a leftover's target always exists in the map by
-- the time it is needed. A leftover OF a leftover is not supported and would
-- land with a null pointer; the UI never creates one.
create function duplicate_plan(p_id uuid, p_start date) returns uuid
language plpgsql security invoker set search_path = public as $$
declare
  new_id uuid;
  new_item_id uuid;
  shift int;
  r record;
  map jsonb := '{}'::jsonb;
begin
  select case when start_date is null then 0 else p_start - start_date end
    into shift
    from meal_plans where id = p_id;
  if shift is null then
    raise exception 'plan % not found or not readable', p_id;
  end if;

  insert into meal_plans (owner_id, family_id, name, view_mode, is_shared, start_date, length_days)
  select auth.uid(), family_id, name || ' (copy)', view_mode, false, p_start, length_days
    from meal_plans where id = p_id
  returning id into new_id;

  for r in
    select * from meal_plan_items
     where plan_id = p_id
     order by (leftover_of is not null), position
  loop
    insert into meal_plan_items (plan_id, recipe_id, day, meal_slot, position, servings, leftover_of)
    values (
      new_id,
      r.recipe_id,
      case when r.day is null then null else r.day + shift end,
      r.meal_slot,
      r.position,
      r.servings,
      case when r.leftover_of is null then null else (map ->> r.leftover_of::text)::uuid end
    )
    returning id into new_item_id;

    map := map || jsonb_build_object(r.id::text, new_item_id::text);
  end loop;

  return new_id;
end; $$;
