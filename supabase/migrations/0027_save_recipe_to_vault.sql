-- 0027: copy a public recipe into the caller's family vault.
--
-- security invoker on purpose: RLS still decides what the caller may read and write, so
-- this function widens the QUERY and never the permissions. It is the same stance as
-- search_recipes in 0025.

-- READ THIS BEFORE EDITING THE INSERTS BELOW.
-- They deliberately name NO columns of recipes, recipe_ingredients or recipe_steps.
-- replace_recipe_children has a fixed column list and that list has silently dropped a
-- column twice: migration 0009 exists because 0006 dropped `section`, and 0019 had to
-- extend it again for `optional` and `alt_group`. A copy written the obvious way would be
-- a SECOND fixed list with the same failure mode. jsonb_populate_record copies whatever
-- columns exist and overrides only the few that must differ, so a future column is carried
-- automatically. Do not "tidy" this into an explicit column list.
--
-- Both child tables have their OWN id primary key, so the copy must override `id` as well
-- as `recipe_id`. Overriding only the parent link inserts the SOURCE row's id and fails on
-- recipe_steps_pkey. jsonb_populate_record ignores keys the record type does not have, so
-- overriding 'id' stays correct even for a child table that has no id column.
create or replace function save_recipe_to_vault(p_source uuid, p_family uuid)
returns uuid language plpgsql security invoker set search_path = public as $$
declare
  v_new uuid;
  v_cook text;
begin
  -- Only a public recipe is savable. Stated explicitly rather than left to RLS: RLS decides
  -- what the caller MAY read, and a member of the source family can read their own family
  -- rows, which must still not be savable through this path.
  insert into recipes
  select (jsonb_populate_record(null::recipes,
          to_jsonb(r) || jsonb_build_object(
            'id', gen_random_uuid(),
            'family_id', p_family,
            'author_id', auth.uid(),
            'visibility', 'family',
            'source_recipe_id', null,   -- set LAST, see below
            'source_cook_name', null,
            'adapted_at', null,
            'created_at', now(),
            'updated_at', now()))).*
  from recipes r
  where r.id = p_source and r.visibility = 'public'
  returning id into v_new;

  if v_new is null then
    raise exception 'recipe % is not available to save', p_source
      using errcode = 'insufficient_privilege';
  end if;

  insert into recipe_ingredients
  select (jsonb_populate_record(null::recipe_ingredients,
          to_jsonb(ri) || jsonb_build_object(
            'id', gen_random_uuid(),   -- children carry their OWN id primary key
            'recipe_id', v_new))).*
  from recipe_ingredients ri where ri.recipe_id = p_source;

  insert into recipe_steps
  select (jsonb_populate_record(null::recipe_steps,
          to_jsonb(rs) || jsonb_build_object(
            'id', gen_random_uuid(),   -- children carry their OWN id primary key
            'recipe_id', v_new))).*
  from recipe_steps rs where rs.recipe_id = p_source;

  -- Photos, tags, comments and the cook log deliberately do NOT travel. Photos are foldered
  -- by recipe id in storage and readable via can_read_recipe(folder), so a copy pointing at
  -- the source's file would go dark the moment the original was unpublished, which is the
  -- exact failure copying exists to prevent. Tag ids belong to the source family.
  -- From public_recipe_bylines, NOT from profiles. profiles_self_read only lets you read
  -- yourself and people in your own families, so a stranger joining profiles here silently
  -- returns no row and the credit lands null: the whole point of the feature, lost without
  -- an error. That view is the project's one seam for a cook's PUBLISHED name, which is
  -- exactly what a credit line should show.
  select b.public_name into v_cook
  from public_recipe_bylines b where b.recipe_id = p_source;
  v_cook := coalesce(v_cook, 'a cook');

  -- LAST, and in its own statement. Copying the children above ran with source_recipe_id
  -- still null, so the adaptation trigger ignored them; and the recipes trigger's when
  -- clause excludes this update, because recording lineage is not an adaptation. Reorder
  -- this and every copy is born adapted.
  update recipes
     set source_recipe_id = p_source, source_cook_name = v_cook
   where id = v_new;

  return v_new;
end; $$;
