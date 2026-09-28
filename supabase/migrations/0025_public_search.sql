-- 0025: let search_recipes serve the public catalogue as well as one family's vault, so
-- Potluck's search and the vault's search share ONE matching rule and one set of trigram
-- indexes. A second search function is how the two silently drift apart, and this repo has
-- twice paid to delete duplicated rules (groceryLabels.ts, the shared aisle rule).
--
-- THE FAMILY BRANCH IS UNCHANGED, and that is load bearing. Migration 0009 exists only
-- because 0006 redefined an RPC and silently dropped a column. The only new behaviour here
-- is p_family_id null, which means the public catalogue across all families. Everything
-- else, including the whole order by, is carried over verbatim from 0010.
--
-- SECURITY INVOKER is retained: RLS still decides what the caller may actually see, so this
-- function widens the QUERY, never the permissions.
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
