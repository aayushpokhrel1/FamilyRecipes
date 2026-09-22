-- Fuzzy recipe search. listRecipes previously did substring-only matching and
-- built a PostgREST `or=` filter expression out of the raw search term, so a
-- typo ("chiken") or a variant ("tomatos") found nothing and a `%`/`*` in the
-- term leaked into the filter language. pg_trgm gives typo-tolerant matching,
-- and moving the search into an RPC makes the term a bound parameter instead of
-- interpolated SQL/filter text.
--
-- Supabase keeps extensions in the `extensions` schema, which is not on the
-- migration role's search_path on the cloud (see 0001_core.sql, which enables
-- pgcrypto there and calls extensions.gen_random_bytes). So enable pg_trgm in
-- `extensions` and resolve its operators/opclasses explicitly: the function sets
-- search_path = public, extensions so `%` and similarity() resolve, and the
-- index opclasses are schema-qualified as extensions.gin_trgm_ops.
create extension if not exists pg_trgm with schema extensions;

-- GIN trigram indexes keep the search fast as the vault grows.
create index recipes_title_trgm_idx on recipes using gin (title extensions.gin_trgm_ops);
create index recipe_ingredients_item_trgm_idx on recipe_ingredients using gin (item extensions.gin_trgm_ops);

-- SECURITY INVOKER (the default, stated here for intent) keeps RLS enforced as
-- the calling user, so this adds NO new authorization surface: the recipes_read
-- policy (0003) still gates which rows are visible. This is deliberately unlike
-- join_family_by_code (0005), which needed SECURITY DEFINER to bypass RLS.
create function search_recipes(p_family_id uuid, p_search text, p_tag_id uuid default null)
returns setof recipes
language sql stable security invoker set search_path = public, extensions as $$
  -- Normalize the term once: trim it, and treat whitespace-only as "no search".
  -- Trimming has to apply to the MATCHING too, not just the is-it-blank test:
  -- a trailing space (mobile keyboards add one) would otherwise turn into
  -- ilike '%chicken %' and match nothing.
  with q as (select nullif(trim(coalesce(p_search, '')), '') as term)
  select r.*
  from recipes r, q
  where r.family_id = p_family_id
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
