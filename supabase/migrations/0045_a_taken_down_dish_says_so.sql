-- 0045: a taken-down dish stops claiming to be published.
--
-- Found by walking the app on 2026-10-11: after "Take it down", the kitchen page still read
-- "Published at https://..." and offered to take it down again. unpublish_dish sets the
-- snapshot recipe to `family` visibility, which hides it from everyone, but the snapshot ROW
-- stayed exactly as it was, so nothing in the kitchen schema could tell the two states apart.
-- An owner could not answer "is our dish public right now", which is the only question this
-- panel exists to answer.
--
-- THIS FILE IS PART OF THE BRIDGE, the one place the two products touch, because replacing
-- unpublish_dish means restating its update of public.recipes. supabase/kitchen_seal.test.ts
-- lists every bridge migration by name and fails for any other file that reaches across.
alter table kitchen.published_snapshots add column unpublished_at timestamptz;

-- Published means: a snapshot row exists AND it has not been taken down. Keeping the row
-- when it is taken down is deliberate: it holds the recipe id, so re-publishing reuses the
-- same public URL and the link somebody already sent keeps working.
create or replace function kitchen.publish_dish(p_version uuid) returns uuid
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
  if kitchen.staff_role(v_org) is distinct from 'owner' then
    raise exception 'only an owner may publish a dish' using errcode = 'KIT01';
  end if;
  if not exists (select 1 from kitchen.approvals where version_id = p_version) then
    raise exception 'sign that version off first' using errcode = 'KIT03';
  end if;

  select * into v_snap from kitchen.published_snapshots where dish_id = v_dish;

  if v_snap.dish_id is null then
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
    update public.recipes
      set title = v_title, visibility = 'public', updated_at = now()
      where id = v_recipe;
    -- unpublished_at back to null: this is the row that says whether it is public.
    update kitchen.published_snapshots
      set version_id = p_version, published_by = auth.uid(), published_at = now(),
          unpublished_at = null
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

create or replace function kitchen.unpublish_dish(p_dish uuid) returns void
language plpgsql security definer set search_path = kitchen, public as $$
declare v_org uuid; v_recipe uuid;
begin
  select d.org_id, s.recipe_id into v_org, v_recipe
  from kitchen.dishes d
  join kitchen.published_snapshots s on s.dish_id = d.id
  where d.id = p_dish and s.unpublished_at is null;
  if v_recipe is null then
    raise exception 'that dish is not published' using errcode = 'KIT04';
  end if;
  if kitchen.staff_role(v_org) is distinct from 'owner' then
    raise exception 'only an owner may unpublish a dish' using errcode = 'KIT01';
  end if;
  update public.recipes set visibility = 'family' where id = v_recipe;
  update kitchen.published_snapshots set unpublished_at = now() where dish_id = p_dish;
end; $$;
