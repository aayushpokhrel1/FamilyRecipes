-- 0035: the hiding rule for a cleared public name, and the appeal path that reverses it.
--
-- Two things in one migration because they ship together: the rule that takes a cleared
-- cook's recipes out of Potluck, and the one way that cook can argue the decision was wrong.

-- READ THIS BEFORE INLINING THIS BACK INTO THE PREDICATE BELOW. profiles is readable only by
-- the cook themselves and their co-members (profiles_self_read, 0002), and search_recipes is
-- security invoker, so a plain `not exists (select 1 from profiles p where ...)` subquery
-- reads NOTHING for a stranger: the guard silently passes and a cleared cook's recipes stay
-- in the feed for exactly the people the rule is for. This is the same trap 0029 documents on
-- hidden_from_feed, and the same shape as can_read_recipe, is_moderator and is_published_cook.
-- security definer so it can answer the question without exposing the row.
--
-- It returns a boolean and never reveals the reason or anything else about the profile.
create or replace function name_cleared_and_unset(p_cook uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles p
    where p.id = p_cook
      and p.name_cleared_at is not null
      and p.public_name is null
  );
$$;

-- RESTATED IN FULL from 0029. This repo has been bitten twice by redefining something and
-- silently losing part of it: migration 0009 exists only because 0006 dropped a column that
-- way. Everything below except the final `and not name_cleared_and_unset(...)` is carried
-- over VERBATIM from 0029, including the block filtering and the whole order by.
--
-- WHY THE HIDING RULE LIVES HERE AND NOWHERE ELSE. listPublicRecipes routes the searched AND
-- the unsearched feed through this one function, and src/lib/api/recipes.ts records why: a
-- second path that queried `recipes` directly silently bypassed every rule this function
-- held, so a muted cook stayed in the feed until you typed something. A client-side filter
-- would reintroduce exactly that, and it would also be wrong, since RLS hides the rows where
-- someone blocked YOU, so only the database can see both halves.
--
-- WHAT IT DOES NOT DO: the recipe stays visibility = 'public', so a direct link still opens,
-- exactly as a blocked cook can still read a public page. That matches the honesty rule in
-- the 4b spec: the UI must not claim the recipes are private. The cook page is untouched
-- (listPublicRecipesByAuthor queries recipes directly), and it self-heals the moment a public
-- name is set.
--
-- THE PREDICATE IS GUARDED BY `p_family_id is not null`, exactly like the block filter
-- above, and it must stay that way. Without the guard it reached inside the cook's own
-- household: their Recipes page read "No recipes yet" while the recipe was still there, and
-- the banner telling them their recipes were hidden "from Potluck" was then a false
-- statement about where. Caught in the browser on 2026-10-02, after the unit and integration
-- suites were green, and now pinned by "a cleared cook still sees their own recipe in their
-- own vault" in tests/integration/appeals.test.ts. The remedy takes a name out of the public
-- catalogue; it is not a punishment aimed at the family who live with the cook.
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
    -- NEW in 0035: a cook whose public name was cleared and who has not set a new one has
    -- their public recipes hidden from Potluck. The condition is the pair, not the timestamp
    -- alone: setting a public name is the self-heal, and it needs no moderator. Through
    -- name_cleared_and_unset, not a subquery: see the note on that function. The
    -- `p_family_id is not null` half keeps the rule in the public catalogue, where it
    -- belongs: see the note above this function.
    and (
      p_family_id is not null
      or not name_cleared_and_unset(r.author_id)
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

-- The appeal path. Any cook with a live moderation action against them may appeal it once
-- at a time, and granting the appeal performs the undo in the SAME transaction as the
-- resolution, so an appeal can never read as granted while the thing it reverses is still
-- in force.
create table appeals (
  id uuid primary key default gen_random_uuid(),
  cook_id uuid not null references profiles(id) on delete cascade,
  -- 'name' | 'recipe' | 'suspension'. A recipe appeal carries the recipe; the other two
  -- carry null, because the subject IS the cook.
  subject_type text not null check (subject_type in ('name','recipe','suspension')),
  subject_id uuid references recipes(id) on delete cascade,
  body text not null check (length(btrim(body)) between 1 and 1000),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  -- 'granted' | 'declined', null while open
  outcome text check (outcome in ('granted','declined')),
  moderator_note text
);

-- One OPEN appeal per cook per subject. A PARTIAL index rather than a check constraint,
-- because "open" is a state rather than a column value: the constraint would have to be
-- written against resolved_at, and a plain unique index on the three columns would make a
-- declined appeal final forever by refusing the row rather than by any rule anyone wrote.
-- A declined appeal is final here anyway (see the spec), but that is a decision, not an
-- accident of the index.
-- NULLS NOT DISTINCT is load bearing, not decoration. A 'name' or 'suspension' appeal has a
-- NULL subject_id, because the subject IS the cook, and Postgres treats NULLs as distinct in
-- a unique index by default. So without this a cook could open unlimited name appeals: the
-- index saw every one of them as a different subject. Caught by the test, which inserted a
-- second appeal and was not refused. Needs Postgres 15 or later; this database is on 17.
create unique index appeals_one_open_per_subject
  on appeals (cook_id, subject_type, subject_id) nulls not distinct
  where resolved_at is null;

alter table appeals enable row level security;

-- A cook opens an appeal as themselves, and reads their own. Keyed the same way the reports
-- policies in 0028 are keyed: the insert policy checks the owner column against auth.uid(),
-- and the read policy is the owner OR a moderator.
create policy appeal_insert on appeals for insert
  with check (cook_id = auth.uid());

create policy appeal_read on appeals for select
  using (cook_id = auth.uid() or is_moderator());

-- Resolution goes through resolve_appeal() below, never a direct update. The policy exists
-- so the moderator queue can be read and so a future moderator-side edit is not silently
-- impossible, but the undo itself is the function's job.
create policy appeal_moderate on appeals for update using (is_moderator());

-- Every moderator action on an appeal, atomic with the undo it performs. security definer
-- for the same reason resolve_report is: a moderator is neither the appealing cook nor the
-- author of the appealed recipe, so the appeals and recipes RLS policies would refuse them,
-- and this function is definer precisely so the moderator check happens ONCE, here, rather
-- than being widened into those policies.
--
-- AN APPEAL MUST NEVER READ AS GRANTED WHILE THE THING IT REVERSES IS STILL IN FORCE. That
-- is why the undo is in this function rather than in a second call from the client: two
-- calls are two transactions, and the gap between them is a state where the appeal says
-- granted and the name is still cleared.
create or replace function resolve_appeal(p_appeal uuid, p_outcome text, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_cook uuid;
  v_type text;
  v_subject uuid;
  v_resolved timestamptz;
begin
  if not is_moderator() then
    raise exception 'not a moderator' using errcode = 'insufficient_privilege';
  end if;
  if p_outcome not in ('granted', 'declined') then
    raise exception 'unknown outcome %', p_outcome using errcode = 'check_violation';
  end if;

  select cook_id, subject_type, subject_id, resolved_at
    into v_cook, v_type, v_subject, v_resolved
    from appeals where id = p_appeal;
  if v_cook is null then
    raise exception 'no such appeal' using errcode = 'no_data_found';
  end if;
  -- A declined appeal is final, and a granted one has already done its undo. Resolving
  -- twice would either re-run the undo or overwrite the record of what was decided.
  if v_resolved is not null then
    raise exception 'this appeal is already resolved' using errcode = 'check_violation';
  end if;

  if p_outcome = 'granted' then
    if v_type = 'name' then
      -- The record goes with the remedy: name_cleared_reason is the reason for a clear that
      -- no longer stands, so leaving it would leave a cook carrying a reason for nothing.
      update profiles
         set name_cleared_at = null, name_cleared_reason = null
       where id = v_cook;
    elsif v_type = 'recipe' then
      -- removed_at is what enforce_publish_rules (0028) reads, so nulling it is what lets
      -- the recipe be published again. visibility is deliberately NOT touched: the author
      -- decides whether to republish, and this function is not the author.
      update recipes
         set removed_at = null, removed_reason = null
       where id = v_subject;
    elsif v_type = 'suspension' then
      update profiles
         set suspended_at = null, suspended_reason = null
       where id = v_cook;
    end if;
  end if;

  update appeals
     set resolved_at = now(), outcome = p_outcome, moderator_note = p_note
   where id = p_appeal;
end; $$;

-- PUBLIC first, then anon. Postgres grants execute to PUBLIC on every new function, and
-- revoking from anon alone does NOT undo that: anon would still reach it through PUBLIC.
-- Same pair as 0032 and 0034, for the same reason.
revoke execute on function resolve_appeal(uuid, text, text) from public;
revoke execute on function resolve_appeal(uuid, text, text) from anon;
grant execute on function resolve_appeal(uuid, text, text) to authenticated;
