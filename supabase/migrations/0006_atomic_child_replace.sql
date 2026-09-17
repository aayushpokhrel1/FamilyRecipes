-- Make child-row replacement atomic. updateRecipe and setRecipeTags previously
-- did delete-then-insert as two separate round trips; a failure between them
-- (network blip, error on insert) wiped a recipe's ingredients/steps/tags with
-- nothing to put back. A plpgsql function body runs in a single transaction, so
-- the delete and insert now commit or roll back together.
--
-- SECURITY INVOKER (the default, stated here for intent) keeps RLS enforced as
-- the calling user, so this adds NO new authorization surface: the author /
-- family-owner write policies on recipe_ingredients, recipe_steps and
-- recipe_tags (0003, 0005) still gate every statement. This is deliberately
-- unlike join_family_by_code (0005), which needed SECURITY DEFINER to bypass RLS.

create function replace_recipe_children(
  p_recipe_id uuid, p_ingredients jsonb, p_steps jsonb
) returns void language plpgsql security invoker set search_path = public as $$
begin
  -- null means "not provided, leave as is"; an empty array means "clear".
  if p_ingredients is not null then
    delete from recipe_ingredients where recipe_id = p_recipe_id;
    insert into recipe_ingredients (recipe_id, position, quantity, unit, item)
    select p_recipe_id, (ord - 1)::int, e->>'quantity', e->>'unit', e->>'item'
    from jsonb_array_elements(p_ingredients) with ordinality as t(e, ord);
  end if;
  if p_steps is not null then
    delete from recipe_steps where recipe_id = p_recipe_id;
    insert into recipe_steps (recipe_id, position, text)
    select p_recipe_id, (ord - 1)::int, e->>'text'
    from jsonb_array_elements(p_steps) with ordinality as t(e, ord);
  end if;
end; $$;

create function set_recipe_tags(p_recipe_id uuid, p_tag_ids uuid[])
returns void language plpgsql security invoker set search_path = public as $$
begin
  delete from recipe_tags where recipe_id = p_recipe_id;
  if array_length(p_tag_ids, 1) is not null then
    insert into recipe_tags (recipe_id, tag_id)
    select p_recipe_id, unnest(p_tag_ids);
  end if;
end; $$;
