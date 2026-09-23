-- A planned recipe can be cooked for a different number of people than it was
-- written for, so the grocery list needs a per-item target. Nullable, where
-- null means "use the recipe's own servings", which keeps every existing row
-- behaving exactly as before and needs no backfill.
--
-- Per item rather than per plan: one plan legitimately mixes a dinner for 8
-- with a lunch for 2. Adding a column does not widen the existing
-- meal_plan_items RLS policies (0008), which already gate the row.
alter table meal_plan_items
  add column servings int check (servings is null or servings > 0);
