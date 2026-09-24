-- 0016: a record of when a family actually cooked something.
--
-- Everything else in this app records INTENT: a recipe exists, a plan says
-- Tuesday. Nothing records that dinner happened. Without that, My Kitchen can
-- only ever show what you told it to show, and can never say the genuinely
-- useful thing: you have not made this since March.
--
-- Deliberately written by an explicit "Mark as cooked" in cook mode, never by
-- opening a recipe. Opening is browsing; an implicit log would fill up with
-- recipes nobody cooked and quietly poison every suggestion built on it.
create table cook_log (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references families(id) on delete cascade,
  recipe_id uuid not null references recipes(id) on delete cascade,
  -- references profiles, not auth.users: a profile outlives its login (0014),
  -- so who cooked it survives that person leaving the family.
  cooked_by uuid not null references profiles(id),
  cooked_at timestamptz not null default now()
);

-- Deliberately NOT unique on (recipe_id, cooked_at::date): cooking the same
-- thing twice in a day is a real thing, and a duplicate here is harmless while
-- a rejected insert would lose a genuine entry.
create index cook_log_family_recipe_idx on cook_log (family_id, recipe_id, cooked_at desc);

alter table cook_log enable row level security;

-- The whole household sees the history: "we haven't made this in months" is a
-- fact about the family's table, not about one cook.
create policy cook_log_read on cook_log for select
  using (is_family_member(family_id));

-- You can only log your own cooking, and only into a family you belong to.
create policy cook_log_insert on cook_log for insert
  with check (is_family_member(family_id) and cooked_by = auth.uid());

-- Undoing a mis-tap is your own to undo, and nobody else's to rewrite.
create policy cook_log_delete on cook_log for delete
  using (cooked_by = auth.uid());
