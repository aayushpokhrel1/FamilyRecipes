-- 0023: following a cook. Private to the follower: there is no follower list and no follower
-- count anywhere, which is one policy instead of a denormalised counter to keep in sync, and
-- keeps vanity metrics out of an app about family cooking. This can be opened up later; it
-- cannot easily be closed once people have seen numbers.
create table follows (
  follower_id uuid not null references profiles(id) on delete cascade,
  cook_id     uuid not null references profiles(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (follower_id, cook_id),
  -- following yourself would put your own recipes into a feed meant for other people's
  constraint no_self_follow check (follower_id <> cook_id)
);

alter table follows enable row level security;

-- Private to the follower. No other read path exists, so there is nothing to expose a
-- follower list through even by accident.
create policy follows_read on follows for select using (follower_id = auth.uid());

-- NOTE the write predicate is about WRITE rights, not readability. Guarding a write with a
-- read predicate is the bug 0003 shipped on recipe_tags and 0005 had to fix.
--
-- is_published_cook is the SECURITY DEFINER function from 0022, reused rather than inlined.
-- A subquery inside an RLS policy runs as the CALLER, so reading profiles inline here would
-- be subject to profiles' own RLS and would be false for everyone. That exact mistake was
-- made and caught on the avatars policy in sub-project 1.
create policy follows_write on follows for all
  using (follower_id = auth.uid())
  with check (follower_id = auth.uid() and is_published_cook(cook_id));

-- Feed reads filter recipes by a list of followed cook ids, so the lookup is always
-- "everyone I follow", never "everyone who follows this cook".
create index follows_follower_idx on follows (follower_id);
