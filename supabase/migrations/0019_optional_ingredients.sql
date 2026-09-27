-- Some ingredients are not required: a handful of basil you add if you have it, or yogurt you
-- use when there is no cream. Both had to be smuggled into the item text until now, where
-- nothing could act on them and they polluted ingredient matching and the grocery list.
alter table recipe_ingredients
  add column optional boolean not null default false,
  -- NOT a reference to another ingredient. replace_recipe_children below deletes and
  -- re-inserts every row on every edit, so ids are regenerated each save and any id-based
  -- link would die immediately. Rows of one recipe sharing a non-null alt_group are
  -- alternatives for each other, and the LOWEST position among them is the one the grocery
  -- list buys. A key travels with its row; a reference has to be kept in sync and cannot be.
  add column alt_group text;

-- READ THIS BEFORE ADDING ANOTHER INGREDIENT COLUMN.
-- This function has a FIXED column list, so a new column that is not added here is silently
-- dropped the first time anyone edits a recipe: no error, no clue, just gone. Migration 0009
-- exists solely because 0006 did this to `section`. Do not let it happen a third time.
create or replace function replace_recipe_children(
  p_recipe_id uuid, p_ingredients jsonb, p_steps jsonb
) returns void language plpgsql security invoker set search_path = public as $$
begin
  if p_ingredients is not null then
    delete from recipe_ingredients where recipe_id = p_recipe_id;
    insert into recipe_ingredients
      (recipe_id, position, quantity, unit, item, section, optional, alt_group)
    select p_recipe_id, (ord - 1)::int, e->>'quantity', e->>'unit', e->>'item', e->>'section',
           coalesce((e->>'optional')::boolean, false), e->>'alt_group'
    from jsonb_array_elements(p_ingredients) with ordinality as t(e, ord);
  end if;
  if p_steps is not null then
    delete from recipe_steps where recipe_id = p_recipe_id;
    insert into recipe_steps (recipe_id, position, text)
    select p_recipe_id, (ord - 1)::int, e->>'text'
    from jsonb_array_elements(p_steps) with ordinality as t(e, ord);
  end if;
end; $$;
