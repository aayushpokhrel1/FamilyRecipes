-- 0013: let a family teach the app which aisle an ingredient belongs to.
--
-- The static catalog in src/lib/catalog.ts knows about a hundred mostly western
-- staples, so anything outside it (besan, gochujang, patis, calamansi) lands in
-- "Other" on the grocery list. Rather than growing that file forever, a family
-- can tag an unknown ingredient once and have it stick for everyone in the
-- household, in every recipe and every list from then on.
--
-- Storing this is safe in a way that storing a category ON a recipe would not
-- be: it is a fact about an ingredient held per family, not a guess written
-- into someone's recipe, so it cannot go stale behind a recipe edit.
create table ingredient_categories (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references families(id) on delete cascade,
  key text not null,      -- normalizeItem() output, the same key the grocery list groups by
  category text not null, -- an aisle name; the UI offers the catalog's own list
  unique (family_id, key)
);

-- One household, one set of aisles: scoped exactly like pantry_staples.
alter table ingredient_categories enable row level security;
create policy ingredient_categories_read on ingredient_categories for select
  using (is_family_member(family_id));
create policy ingredient_categories_write on ingredient_categories for all
  using (is_family_member(family_id)) with check (is_family_member(family_id));
