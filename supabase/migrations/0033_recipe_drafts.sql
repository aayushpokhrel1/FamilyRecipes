-- 0033: an unfinished recipe survives the tab closing.
--
-- Today the create form holds everything in React state, so closing the tab, hitting a flaky
-- extraction or wandering off mid-recipe loses the lot. A draft is that form, saved.
--
-- A draft lives in its OWN table and never as a flag on recipes. There are 11 queries against
-- recipes plus search_recipes, and a flag would mean teaching all 12 to exclude drafts. That
-- is exactly the bug that let muted cooks stay in Potluck: the rule lived in one query path
-- and the other ignored it. A separate table cannot be forgotten by a query that never knew
-- about it.
--
-- A draft belongs to its AUTHOR alone. It is unfinished thinking, not family property, so
-- there is deliberately NO family-member policy of any kind below. Membership is not enough
-- to read a draft, and the integration test proves it by putting two cooks in one family.

create table recipe_drafts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references profiles(id) on delete cascade,
  -- Where it lands when finished. not null is safe ONLY because of the kitchen invariant in
  -- 0032: every cook now has at least one family, so there is always a legitimate target.
  target_family_id uuid not null references families(id) on delete cascade,
  -- 5b only. 5a NEVER sets this and enforces nothing about it. It is here because the table
  -- shape was decided with it, and adding it later would mean a second migration on the same
  -- table for a column the design already assumes.
  target_recipe_id uuid references recipes(id) on delete cascade,
  title text not null,
  -- The whole RecipeDraft minus the title: ingredients, steps, story, provenance, servings,
  -- timings, source_url, and the chosen visibility. Deliberately NOT mirrored into columns
  -- and child tables: a draft is never queried by ingredient, only listed by title and
  -- loaded whole, so columns would buy nothing and would hand us a second copy of
  -- replace_recipe_children, which has silently dropped a column twice (see 0009 and 0019).
  --
  -- The known ceiling, stated rather than hidden: body is schemaless, so a future change to
  -- RecipeDraft can leave an old draft's body shaped like the old version. It is written and
  -- read by the same TypeScript type, so the risk is a missing field reading as undefined,
  -- not corruption. The loader must therefore treat every field in body as optional and fill
  -- defaults. If drafts ever need to outlive several schema changes, add a version int and
  -- migrate on read; do not add it before there is a second version.
  body jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- The drafts list is "mine, newest first", which is exactly this index. updated_at desc
-- rather than created_at desc because a resumed draft that is saved again must move to the
-- top, or a cook who saves three times cannot tell which one is current.
create index recipe_drafts_author_idx on recipe_drafts (author_id, updated_at desc);

alter table recipe_drafts enable row level security;

-- Every policy keys on author_id = auth.uid(), and there is no family-member policy of any
-- kind. A draft is not family property, and there is no path by which anyone else should
-- read one. The insert check also pins author_id to the caller, so a cook cannot write a
-- draft that claims to be someone else's and then be unable to see it.
create policy drafts_read on recipe_drafts for select using (author_id = auth.uid());
create policy drafts_insert on recipe_drafts for insert with check (author_id = auth.uid());
create policy drafts_update on recipe_drafts for update using (author_id = auth.uid());
create policy drafts_delete on recipe_drafts for delete using (author_id = auth.uid());

-- updated_at is touched on update so the drafts list can sort by "when it was last touched".
-- 0008 (meal plans) declares the column but never touches it, so there is no shared function
-- to reuse here; this is the one home for the rule. If a second table ever needs the same
-- touch, move this function out and share it rather than copying it.
create function touch_updated_at() returns trigger
language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  return new;
end; $$;

create trigger recipe_drafts_touch_updated_at
before update on recipe_drafts
for each row execute function touch_updated_at();
