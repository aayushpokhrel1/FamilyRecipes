create type recipe_visibility as enum ('private','family','public');

create table recipes (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references families(id) on delete cascade,
  author_id uuid not null references profiles(id),
  title text not null,
  story text,
  provenance text,
  servings int,
  prep_minutes int,
  cook_minutes int,
  visibility recipe_visibility not null default 'family',
  source_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table recipe_ingredients (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references recipes(id) on delete cascade,
  position int not null,
  quantity text, unit text, item text not null
);
create table recipe_steps (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references recipes(id) on delete cascade,
  position int not null,
  text text not null
);
create table recipe_photos (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references recipes(id) on delete cascade,
  storage_path text not null,
  is_cover boolean not null default false
);
create table comments (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references recipes(id) on delete cascade,
  author_id uuid not null references profiles(id),
  body text not null,
  created_at timestamptz not null default now()
);
create table tags (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references families(id) on delete cascade,
  name text not null,
  unique (family_id, name)
);
create table recipe_tags (
  recipe_id uuid not null references recipes(id) on delete cascade,
  tag_id uuid not null references tags(id) on delete cascade,
  primary key (recipe_id, tag_id)
);

-- readability predicate reused across child tables
create function can_read_recipe(rid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from recipes r where r.id = rid and (
    r.visibility = 'public'
    or (r.visibility = 'family' and is_family_member(r.family_id))
    or (r.visibility = 'private' and r.author_id = auth.uid())
  ));
$$;

alter table recipes enable row level security;
alter table recipe_ingredients enable row level security;
alter table recipe_steps enable row level security;
alter table recipe_photos enable row level security;
alter table comments enable row level security;
alter table tags enable row level security;
alter table recipe_tags enable row level security;

-- recipes
create policy recipes_read on recipes for select using (
  visibility = 'public'
  or (visibility = 'family' and is_family_member(family_id))
  or (visibility = 'private' and author_id = auth.uid()));
create policy recipes_insert on recipes for insert with check (
  author_id = auth.uid() and is_family_member(family_id));
create policy recipes_update on recipes for update using (
  author_id = auth.uid() or exists (select 1 from family_members
    where family_id = recipes.family_id and user_id = auth.uid() and role='owner'));
create policy recipes_delete on recipes for delete using (
  author_id = auth.uid() or exists (select 1 from family_members
    where family_id = recipes.family_id and user_id = auth.uid() and role='owner'));

-- child rows: readable if parent readable, writable if author of parent or family owner
create policy ing_read on recipe_ingredients for select using (can_read_recipe(recipe_id));
create policy ing_write on recipe_ingredients for all using (
  exists (select 1 from recipes r where r.id = recipe_id and (r.author_id = auth.uid()
    or exists (select 1 from family_members m where m.family_id=r.family_id and m.user_id=auth.uid() and m.role='owner'))))
  with check (exists (select 1 from recipes r where r.id = recipe_id and (r.author_id = auth.uid()
    or exists (select 1 from family_members m where m.family_id=r.family_id and m.user_id=auth.uid() and m.role='owner'))));
create policy step_read on recipe_steps for select using (can_read_recipe(recipe_id));
create policy step_write on recipe_steps for all using (
  exists (select 1 from recipes r where r.id = recipe_id and (r.author_id = auth.uid()
    or exists (select 1 from family_members m where m.family_id=r.family_id and m.user_id=auth.uid() and m.role='owner'))))
  with check (exists (select 1 from recipes r where r.id = recipe_id and (r.author_id = auth.uid()
    or exists (select 1 from family_members m where m.family_id=r.family_id and m.user_id=auth.uid() and m.role='owner'))));
create policy photo_read on recipe_photos for select using (can_read_recipe(recipe_id));
create policy photo_write on recipe_photos for all using (
  exists (select 1 from recipes r where r.id = recipe_id and r.author_id = auth.uid()))
  with check (exists (select 1 from recipes r where r.id = recipe_id and r.author_id = auth.uid()));

-- comments: read if recipe readable; write if family member of the recipe's family
create policy comments_read on comments for select using (can_read_recipe(recipe_id));
create policy comments_insert on comments for insert with check (
  author_id = auth.uid()
  and exists (select 1 from recipes r where r.id = recipe_id and is_family_member(r.family_id)));
create policy comments_delete on comments for delete using (author_id = auth.uid());

-- tags scoped to family membership
create policy tags_read on tags for select using (is_family_member(family_id));
create policy tags_write on tags for all using (is_family_member(family_id))
  with check (is_family_member(family_id));
create policy rtags_read on recipe_tags for select using (can_read_recipe(recipe_id));
create policy rtags_write on recipe_tags for all using (can_read_recipe(recipe_id))
  with check (can_read_recipe(recipe_id));
