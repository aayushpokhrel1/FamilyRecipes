-- Ingredient sections: group a recipe's ingredients under named components.
alter table recipe_ingredients add column section text;

-- replace_recipe_children (0006) inserted a fixed column list without `section`,
-- so edits would drop it. Redefine it to carry section through.
create or replace function replace_recipe_children(
  p_recipe_id uuid, p_ingredients jsonb, p_steps jsonb
) returns void language plpgsql security invoker set search_path = public as $$
begin
  if p_ingredients is not null then
    delete from recipe_ingredients where recipe_id = p_recipe_id;
    insert into recipe_ingredients (recipe_id, position, quantity, unit, item, section)
    select p_recipe_id, (ord - 1)::int, e->>'quantity', e->>'unit', e->>'item', e->>'section'
    from jsonb_array_elements(p_ingredients) with ordinality as t(e, ord);
  end if;
  if p_steps is not null then
    delete from recipe_steps where recipe_id = p_recipe_id;
    insert into recipe_steps (recipe_id, position, text)
    select p_recipe_id, (ord - 1)::int, e->>'text'
    from jsonb_array_elements(p_steps) with ordinality as t(e, ord);
  end if;
end; $$;
