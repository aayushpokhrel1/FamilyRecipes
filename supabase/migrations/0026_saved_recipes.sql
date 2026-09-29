-- 0026: lineage for a saved copy, and the two guards that make copying safe.
--
-- A save COPIES a recipe rather than pointing at it, so that unpublishing or deleting the
-- original cannot empty someone else's vault. These columns record where a copy came from.

alter table recipes
  add column source_recipe_id uuid references recipes(id) on delete set null,
  add column source_cook_name text,
  add column adapted_at timestamptz;

-- source_cook_name is a SNAPSHOT, not a join, and deliberately survives the FK going null.
-- The original cook must not be able to erase her name from a copy any more than she can
-- erase the copy itself. The accepted cost is that it goes stale if she renames herself.
comment on column recipes.source_cook_name is
  'Snapshot of the original cook''s published name at save time. Never joined at read time.';

-- A saved copy cannot be published. Dropping this ONE constraint is the entire change if
-- republishing is later allowed, which is exactly why it is a constraint and not a rule
-- spread across the UI. Moderation does not exist yet and is the gate on opening Potluck.
alter table recipes add constraint saved_copies_are_not_publishable
  check (source_recipe_id is null or visibility <> 'public');

-- Saving the same recipe into the same vault twice is a no-op, not a duplicate. Per FAMILY,
-- not per user: the vault belongs to the household, so two members must not end up with two
-- copies of one recipe.
create unique index recipes_one_copy_per_family
  on recipes (family_id, source_recipe_id) where source_recipe_id is not null;

-- A copy reads "Saved from Mei's kitchen" until it is edited and "from Mei" afterwards, so
-- something has to notice the first edit.
--
-- READ THIS BEFORE CHANGING THE TRIGGER LIST BELOW. updateRecipe sends the recipes row and
-- the children down DIFFERENT paths, and an ingredient-only edit does not touch the recipes
-- row at all. A trigger on recipes alone would miss the edit most likely to be someone's
-- first: changing an amount. Any new child table that counts as "editing the recipe" needs
-- its own trigger here.
--
-- security definer on purpose: this is internal bookkeeping, not a permission. A family
-- member who may edit the ingredients but is not the recipe's author would otherwise have
-- their UPDATE silently filtered to zero rows by RLS, and the copy would never be marked.
-- It widens nothing: it only ever sets adapted_at, and only on a row that is already a copy.
create or replace function mark_recipe_adapted() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  if tg_table_name = 'recipes' then
    v_id := new.id;
  elsif tg_op = 'DELETE' then
    v_id := old.recipe_id;
  else
    v_id := new.recipe_id;
  end if;

  update recipes set adapted_at = now()
  where id = v_id and source_recipe_id is not null and adapted_at is null;

  return null;
end; $$;

-- The when clause does two jobs. It stops the trigger's own adapted_at update from
-- re-firing it, and it excludes the lineage-setting update that save_recipe_to_vault runs
-- LAST, so recording where a copy came from is not itself an adaptation. Without that
-- exclusion every copy would be born adapted.
create trigger recipes_mark_adapted
after update on recipes
for each row
when (old.source_recipe_id is not distinct from new.source_recipe_id
      and old.adapted_at is not distinct from new.adapted_at)
execute function mark_recipe_adapted();

create trigger recipe_ingredients_mark_adapted
after insert or update or delete on recipe_ingredients
for each row execute function mark_recipe_adapted();

create trigger recipe_steps_mark_adapted
after insert or update or delete on recipe_steps
for each row execute function mark_recipe_adapted();