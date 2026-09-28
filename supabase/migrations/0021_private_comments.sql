-- 0021: comments_read has inherited can_read_recipe since 0003, and can_read_recipe grants on
-- PUBLIC grounds. So publishing a recipe silently published the family's conversation about
-- it, with no warning anywhere in the UI. Confirmed by test before this migration existed:
-- a stranger and an anonymous visitor could both read a family's comments on a public recipe.
--
-- Comments are readable on FAMILY or PRIVATE grounds only. Note the family arm covers
-- 'public' as well: a family must keep reading comments on its own recipe after publishing
-- it. What must never grant access is PUBLIC-ness alone.
--
-- Deliberately a SECOND predicate rather than a change to can_read_recipe. That one is
-- correct for ingredients, steps and photos, which are exactly the parts of a published
-- recipe a stranger is meant to read. Only comments differ.
create function can_read_recipe_privately(rid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from recipes r where r.id = rid and (
    (r.visibility in ('family','public') and is_family_member(r.family_id))
    or (r.visibility = 'private' and r.author_id = auth.uid())
  ));
$$;

drop policy comments_read on comments;
create policy comments_read on comments for select using (can_read_recipe_privately(recipe_id));
