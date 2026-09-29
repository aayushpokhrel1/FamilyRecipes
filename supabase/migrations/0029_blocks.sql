-- 0029: mute and block. A viewer preference, not moderation: no moderator sees these and the
-- blocked cook is never told.

create table blocks (
  blocker_id uuid not null references profiles(id) on delete cascade,
  blocked_id uuid not null references profiles(id) on delete cascade,
  -- One table with a kind, not two tables. Mute and block differ in what they DO, not in
  -- what they are, and two tables would mean two policies, two queries, and a way to be in
  -- both at once. Changing a mute to a block is then an update, not a delete and an insert.
  kind text not null check (kind in ('mute', 'block')),
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  constraint no_self_block check (blocker_id <> blocked_id)
);

alter table blocks enable row level security;

-- Private to the blocker, exactly like follows. A block the other person can discover is not
-- a block, and this policy is the only reason that holds.
create policy block_own on blocks for all
  using (blocker_id = auth.uid())
  with check (blocker_id = auth.uid());

-- Blocking severs an existing follow in BOTH directions. A trigger rather than application
-- code, so it holds no matter which client does the insert.
create or replace function sever_follows_on_block() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.kind = 'block' then
    delete from follows
    where (follower_id = new.blocker_id and cook_id = new.blocked_id)
       or (follower_id = new.blocked_id and cook_id = new.blocker_id);
  end if;
  return new;
end; $$;

create trigger blocks_sever_follows
after insert or update on blocks
for each row execute function sever_follows_on_block();

-- READ THIS BEFORE INLINING EITHER OF THESE BACK INTO A POLICY OR A QUERY.
-- blocks is readable ONLY by the blocker, which is what keeps a block private. But both
-- rules below have to ask "did THEY block ME?", which reads a row the caller does not own.
-- Inlined as a plain subquery under security invoker, RLS returns nothing and the guard
-- silently passes: the block appears to work in one direction and not the other. These two
-- functions are security definer so they can answer the question without exposing the row,
-- the same shape as can_read_recipe, is_moderator and is_published_cook.
--
-- They return a boolean and never reveal WHO blocked whom or how many rows exist. A blocked
-- cook can still infer a block by noticing recipes vanish, but that is inherent in the choice
-- to hide symmetrically, not something these functions add.
create or replace function blocked_between(a uuid, b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from blocks bl
    where bl.kind = 'block'
      and ((bl.blocker_id = a and bl.blocked_id = b)
        or (bl.blocker_id = b and bl.blocked_id = a))
  );
$$;

-- Hidden from viewer's PUBLIC catalogue: anything the viewer muted or blocked, plus anyone
-- who blocked the viewer. Mute is deliberately one way, so a mute by the author does not
-- hide the author from the viewer.
create or replace function hidden_from_feed(p_viewer uuid, p_author uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from blocks bl
    where (bl.blocker_id = p_viewer and bl.blocked_id = p_author)
       or (bl.blocker_id = p_author and bl.blocked_id = p_viewer and bl.kind = 'block')
  );
$$;

-- RESTATED IN FULL from 0023. This repo has been bitten twice by redefining something and
-- silently losing part of it: migration 0009 exists only because 0006 dropped a column that
-- way. Everything below except the final `and not exists` is carried over VERBATIM from
-- 0023, including the note about write predicates.
--
-- NOTE the write predicate is about WRITE rights, not readability. Guarding a write with a
-- read predicate is the bug 0003 shipped on recipe_tags and 0005 had to fix.
drop policy follows_write on follows;
create policy follows_write on follows for all
  using (follower_id = auth.uid())
  with check (
    follower_id = auth.uid()
    and is_published_cook(cook_id)
    -- NEW in 0029: a blocked pair cannot follow either way. A check constraint cannot see
    -- another table, so this has to live in the policy, and it MUST go through
    -- blocked_between: a plain subquery here reads nothing in the direction where the other
    -- person owns the row, so the guard would pass and the follow would be created.
    and not blocked_between(follower_id, cook_id)
  );

-- RESTATED IN FULL from 0025, for the same reason. Everything is carried over verbatim
-- except the single `and not exists` block marked NEW below.
create or replace function search_recipes(p_family_id uuid, p_search text, p_tag_id uuid default null)
returns setof recipes
language sql stable security invoker set search_path = public, extensions as $$
  -- Normalize the term once: trim it, and treat whitespace-only as "no search".
  -- Trimming has to apply to the MATCHING too, not just the is-it-blank test:
  -- a trailing space (mobile keyboards add one) would otherwise turn into
  -- ilike '%chicken %' and match nothing.
  with q as (select nullif(trim(coalesce(p_search, '')), '') as term)
  select r.*
  from recipes r, q
  where (
      -- A null family id means the public catalogue rather than one household's vault.
      -- Stated explicitly even though RLS would refuse a non-public row to a stranger: RLS
      -- decides what you MAY see, this decides what the query IS. Without it, a signed-in
      -- member calling with null would get their own family's private recipes mixed in.
      (p_family_id is null and r.visibility = 'public')
      or r.family_id = p_family_id
    )
    -- NEW in 0029: mute and block hide the PUBLIC CATALOGUE only, never a household's own
    -- vault. `p_family_id is null` guards that: a block must not reach inside a family and
    -- quietly hide a relative's recipe from the people who live with them.
    and (
      p_family_id is not null
      -- through hidden_from_feed, not a subquery: see the note on that function. The
      -- "they blocked me" half reads a row this caller cannot see.
      or not hidden_from_feed(auth.uid(), r.author_id)
    )
    -- Tags stay family-scoped: they are unreadable to a stranger, so a public tag filter
    -- would filter on something the caller cannot see.
    and (p_tag_id is null or exists (
      select 1 from recipe_tags rt where rt.recipe_id = r.id and rt.tag_id = p_tag_id))
    and (
      q.term is null
      or r.title % q.term
      or r.title ilike '%' || q.term || '%'
      or exists (
        select 1 from recipe_ingredients i
        where i.recipe_id = r.id
          and (i.item % q.term or i.item ilike '%' || q.term || '%'))
    )
  order by
    case when q.term is null then 0
      else greatest(
        similarity(r.title, q.term),
        coalesce((select max(similarity(i.item, q.term))
          from recipe_ingredients i where i.recipe_id = r.id), 0))
    end desc,
    r.created_at desc;
$$;
