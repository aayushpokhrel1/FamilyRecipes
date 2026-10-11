-- 0044: THE ONLY PLACE WHERE THE KITCHEN SCHEMA AND THE FAMILY SCHEMA TOUCH.
--
-- If you are looking for every crossing between the two products, it is this file and
-- nothing else. Keep it that way: the seal is the entire reason the kitchen is a second app
-- rather than a workspace type inside the family one. A new cross-schema reference belongs
-- here or nowhere.
--
-- Publishing is a SNAPSHOT COPY, not a live view. Three consequences, all deliberate:
--   * a later menu revision does not silently change the public page; publishing again does;
--   * re-publishing updates the SAME recipe row, so the public URL survives, which is the
--     point of having a link to send;
--   * the snapshot is an ordinary public recipe, so it is inside Potluck's moderation regime
--     like anything else. A takedown sticks, because enforce_publish_rules (0028) fires on
--     this function's insert AND its update.
--
-- The venue family row has NO MEMBERS, and that is the mechanism rather than an oversight:
-- recipes_insert requires is_family_member, so nothing but this definer function can ever
-- put a recipe in it; families_member_read requires membership, so nobody can read it
-- directly; but public_recipe_bylines reads the family name through a view that bypasses RLS
-- on purpose, and its left join on profiles renders the family name alone when the author
-- has no handle. So the dish carries the VENUE's name and no person's handle, and the
-- kitchen never becomes a usable family anywhere.
create table kitchen.published_snapshots (
  dish_id uuid primary key references kitchen.dishes(id) on delete cascade,
  recipe_id uuid not null references public.recipes(id) on delete cascade,
  venue_family_id uuid not null references public.families(id),
  version_id uuid not null references kitchen.dish_versions(id),
  published_by uuid not null references auth.users(id),
  published_at timestamptz not null default now()
);
alter table kitchen.published_snapshots enable row level security;
create policy snapshots_read on kitchen.published_snapshots for select
  using (kitchen.can_read_dish(dish_id));
grant select, insert, update, delete on kitchen.published_snapshots to authenticated, service_role;

create function kitchen.publish_dish(p_version uuid) returns uuid
language plpgsql security definer set search_path = kitchen, public as $$
declare
  v_dish uuid; v_org uuid; v_org_name text; v_title text;
  v_snap kitchen.published_snapshots; v_family uuid; v_recipe uuid;
begin
  select v.dish_id, d.org_id, d.title, o.name
    into v_dish, v_org, v_title, v_org_name
  from kitchen.dish_versions v
  join kitchen.dishes d on d.id = v.dish_id
  join kitchen.orgs o on o.id = d.org_id
  where v.id = p_version;
  if v_dish is null then
    raise exception 'no such version' using errcode = 'KIT04';
  end if;
  -- The owner's alone. Publishing is a marketing act with a legal surface, not a kitchen
  -- act: a chef signs dishes onto the menu but does not speak publicly for the business.
  if kitchen.staff_role(v_org) is distinct from 'owner' then
    raise exception 'only an owner may publish a dish' using errcode = 'KIT01';
  end if;
  if not exists (select 1 from kitchen.approvals where version_id = p_version) then
    raise exception 'sign that version off first' using errcode = 'KIT03';
  end if;

  select * into v_snap from kitchen.published_snapshots where dish_id = v_dish;

  if v_snap.dish_id is null then
    -- The venue family, created once per org, with no member rows. Ever.
    insert into public.families (name, created_by) values (v_org_name, auth.uid())
      returning id into v_family;
    insert into public.recipes (family_id, author_id, title, visibility)
      values (v_family, auth.uid(), v_title, 'public') returning id into v_recipe;
    insert into kitchen.published_snapshots
      (dish_id, recipe_id, venue_family_id, version_id, published_by)
      values (v_dish, v_recipe, v_family, p_version, auth.uid());
  else
    v_family := v_snap.venue_family_id;
    v_recipe := v_snap.recipe_id;
    -- This update re-runs enforce_publish_rules, which is what makes a takedown stick.
    update public.recipes
      set title = v_title, visibility = 'public', updated_at = now()
      where id = v_recipe;
    update kitchen.published_snapshots
      set version_id = p_version, published_by = auth.uid(), published_at = now()
      where dish_id = v_dish;
    delete from public.recipe_ingredients where recipe_id = v_recipe;
    delete from public.recipe_steps where recipe_id = v_recipe;
  end if;

  insert into public.recipe_ingredients (recipe_id, position, quantity, unit, item)
  select v_recipe, i.position, i.quantity, i.unit, i.item
  from kitchen.dish_ingredients i where i.version_id = p_version;

  insert into public.recipe_steps (recipe_id, position, text)
  select v_recipe, s.position, s.text
  from kitchen.dish_steps s where s.version_id = p_version;

  return v_recipe;
end; $$;

-- Unpublish needs no new mechanism: `family` visibility on a family with no members means
-- nobody at all can read it, not even the person who published it.
create function kitchen.unpublish_dish(p_dish uuid) returns void
language plpgsql security definer set search_path = kitchen, public as $$
declare v_org uuid; v_recipe uuid;
begin
  select d.org_id, s.recipe_id into v_org, v_recipe
  from kitchen.dishes d
  join kitchen.published_snapshots s on s.dish_id = d.id
  where d.id = p_dish;
  if v_recipe is null then
    raise exception 'that dish is not published' using errcode = 'KIT04';
  end if;
  if kitchen.staff_role(v_org) is distinct from 'owner' then
    raise exception 'only an owner may unpublish a dish' using errcode = 'KIT01';
  end if;
  update public.recipes set visibility = 'family' where id = v_recipe;
end; $$;
