-- 0036: the cleared-name hiding rule belongs in the PUBLIC CATALOGUE, not inside the
-- household the cook lives in.
--
-- WHY THIS IS A SEPARATE MIGRATION RATHER THAN AN EDIT TO 0035. 0035 had already been applied
-- to cloud when this was found, even though the handover said it had not, so editing it in
-- place would have fixed nothing on production while making the local history disagree with
-- what the remote actually ran: the worst of both. `supabase migration list --linked` is the
-- authority on what is applied, not any document. CHECK IT BEFORE EDITING ANY MIGRATION, and
-- if the version is on the remote, write the next number instead. This repo already had the
-- same lesson from 0009, which exists only because 0006 redefined something and silently lost
-- part of it.
--
-- WHAT WAS WRONG. 0035 added `and not name_cleared_and_unset(r.author_id)` to search_recipes
-- with no scope guard, so it applied to EVERY call, not just the public ones. listRecipes
-- passes a family id to list a household's own vault, so the rule reached in there too: the
-- cleared cook's own Recipes page read "No recipes yet" while the recipe sat in the database
-- untouched, and the app-wide banner telling her the recipes were hidden "from Potluck" was
-- then a false statement about WHERE they had gone. The 4b spec says the vault, the family and
-- the cook page are untouched by the remedy, and the honesty rule says the UI must not claim
-- recipes are gone when they are not.
--
-- The block filter directly above the predicate already carried exactly this guard, added in
-- 0029 for exactly this reason: a remedy aimed at the public catalogue must not quietly hide a
-- relative's recipe from the people who live with them. The new rule simply did not copy it.
--
-- Found by a browser pass as the affected cook, with the unit suite, the integration suite and
-- a code review all green: the integration test asserted the recipe left the PUBLIC feed and
-- never asked what its OWNER could see. Now pinned by "still shows the cleared cook their own
-- recipe in their own vault" in tests/integration/appeals.test.ts, which was watched failing
-- against the unguarded function.
--
-- RESTATED IN FULL, every line carried over from 0035 verbatim except the one predicate, for
-- the reason that migration's own header gives: redefining something and losing part of it is
-- how 0009 came to exist.
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
    -- From 0029: mute and block hide the PUBLIC CATALOGUE only, never a household's own
    -- vault. `p_family_id is null` guards that: a block must not reach inside a family and
    -- quietly hide a relative's recipe from the people who live with them.
    and (
      p_family_id is not null
      -- through hidden_from_feed, not a subquery: see the note on that function. The
      -- "they blocked me" half reads a row this caller cannot see.
      or not hidden_from_feed(auth.uid(), r.author_id)
    )
    -- From 0035, GUARDED here in 0036: a cook whose public name was cleared and who has not
    -- set a new one has their public recipes hidden from the catalogue. The condition is the
    -- pair, not the timestamp alone, because setting a public name is the self-heal and it
    -- needs no moderator. The `p_family_id is not null` half is what keeps the rule out of the
    -- cook's own vault, and it is the whole point of this migration: see the header.
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
