-- 0050: a recipe's CHILD rows were writable without membership of its family.
--
-- 0047 gave `recipes_update` a WITH CHECK requiring `is_family_member(family_id)`, and its
-- comment concluded that a kitchen publisher could therefore no longer edit the published
-- public snapshot directly. The 2026-10-12 audit refuted that, and the comment in 0047 has
-- been corrected. It held only for the `recipes` row itself.
--
-- These four policies and `recipes_delete` were written in 0003, when being a recipe's
-- author implied being a member of its family. `kitchen.publish_dish` (0044) broke that
-- assumption by creating a public recipe whose `author_id` belongs to NO family, so the
-- author arm alone let the publisher rewrite the published ingredients and steps, add
-- steps, and delete the recipe outright, which cascades `kitchen.published_snapshots` and
-- destroys the record linking the public dish to the version that was signed off.
--
-- Tightening one policy on one table and leaving its five siblings is what left the gap.
-- All six now carry the same requirement, so one rule governs every write to a recipe.
--
-- A DELIBERATE CONSEQUENCE, so nobody is surprised by it later: an author who has left a
-- family also loses the ability to edit the recipes they wrote there. That follows from the
-- model 0047 chose, where the destination family's membership governs the write. The
-- alternative, keeping an author's rights after they leave, is the thing that created this
-- bug in the first place.
--
-- publish_dish and unpublish_dish are SECURITY DEFINER and are unaffected, which is the
-- point: changes to a published dish should go through them.

drop policy ing_write on recipe_ingredients;
create policy ing_write on recipe_ingredients for all
  using (exists (select 1 from recipes r where r.id = recipe_id
    and is_family_member(r.family_id)
    and (r.author_id = auth.uid() or exists (select 1 from family_members m
      where m.family_id = r.family_id and m.user_id = auth.uid() and m.role = 'owner'))))
  with check (exists (select 1 from recipes r where r.id = recipe_id
    and is_family_member(r.family_id)
    and (r.author_id = auth.uid() or exists (select 1 from family_members m
      where m.family_id = r.family_id and m.user_id = auth.uid() and m.role = 'owner'))));

drop policy step_write on recipe_steps;
create policy step_write on recipe_steps for all
  using (exists (select 1 from recipes r where r.id = recipe_id
    and is_family_member(r.family_id)
    and (r.author_id = auth.uid() or exists (select 1 from family_members m
      where m.family_id = r.family_id and m.user_id = auth.uid() and m.role = 'owner'))))
  with check (exists (select 1 from recipes r where r.id = recipe_id
    and is_family_member(r.family_id)
    and (r.author_id = auth.uid() or exists (select 1 from family_members m
      where m.family_id = r.family_id and m.user_id = auth.uid() and m.role = 'owner'))));

drop policy photo_write on recipe_photos;
create policy photo_write on recipe_photos for all
  using (exists (select 1 from recipes r where r.id = recipe_id
    and is_family_member(r.family_id) and r.author_id = auth.uid()))
  with check (exists (select 1 from recipes r where r.id = recipe_id
    and is_family_member(r.family_id) and r.author_id = auth.uid()));

drop policy rtags_write on recipe_tags;
create policy rtags_write on recipe_tags for all
  using (exists (select 1 from recipes r where r.id = recipe_id
    and is_family_member(r.family_id)
    and (r.author_id = auth.uid() or exists (select 1 from family_members m
      where m.family_id = r.family_id and m.user_id = auth.uid() and m.role = 'owner'))))
  with check (exists (select 1 from recipes r where r.id = recipe_id
    and is_family_member(r.family_id)
    and (r.author_id = auth.uid() or exists (select 1 from family_members m
      where m.family_id = r.family_id and m.user_id = auth.uid() and m.role = 'owner'))));

drop policy recipes_delete on recipes;
create policy recipes_delete on recipes for delete
  using (is_family_member(family_id)
    and (author_id = auth.uid() or exists (select 1 from family_members
      where family_id = recipes.family_id and user_id = auth.uid() and role = 'owner')));
