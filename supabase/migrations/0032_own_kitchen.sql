-- 0032: every cook always has at least one kitchen.
--
-- handle_new_user() in 0001 creates a profile and NO family, but recipes.family_id is not
-- null and ten pages key off the active family. So a brand-new account can use the AI
-- extraction, fill in the whole form, press Save, and nothing happens: My Kitchen, the
-- Cupboard, meal plans, grocery and cook mode are dead ends too.
--
-- The fix is an INVARIANT rather than a special row: an idempotent ensure_own_kitchen() that
-- creates a family plus an owner membership only when the caller has zero memberships. There
-- is deliberately NO is_personal column. A marker would drag in rules about whether you can
-- invite to it, leave it or delete it, and as a plain family the answer to all three is
-- "same as any other".
--
-- handle_new_user() is deliberately NOT changed. The invariant is established on load and
-- re-established whenever it is broken, which a signup-time trigger alone would not do: a
-- cook who leaves every family would still fall into the dead-button state.

-- ONE home for the naming rule, because it is needed in two places (the function below and
-- the backfill at the end) and a rule that lives in two places is how this project has been
-- bitten before: the block filter lived in one query path, the other ignored it, and muted
-- cooks stayed in Potluck. Change the rule here and both callers change with it.
--
-- The 'Cook' case is named explicitly because it is the DEFAULT in 0001, so it is what a
-- cook who never set a name actually has, and it is not a name. The fallback is "My kitchen"
-- rather than "Cook's kitchen" because the name is PUBLIC: public_recipe_bylines publishes
-- family_name under every recipe published from this kitchen, so "Cook's kitchen" would be
-- visible nonsense under a stranger's recipe.
create function kitchen_name(p_display text) returns text
language sql immutable set search_path = public as $$
  select case
    when p_display is null or btrim(p_display) = '' or p_display = 'Cook' then 'My kitchen'
    else p_display || '''s kitchen'
  end;
$$;

-- security definer on purpose: the caller has no policy that lets them read their own
-- membership rows before they belong to anything, and families_member_read requires
-- membership, so the lookup and the two inserts only work because this runs as its owner.
-- search_path is pinned so the definer rights cannot be redirected at a table in another
-- schema.
create function ensure_own_kitchen() returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid;
  v_family uuid;
  v_name text;
begin
  v_user := auth.uid();
  if v_user is null then
    raise exception 'not signed in' using errcode = 'insufficient_privilege';
  end if;

  -- The lock is taken BEFORE the lookup, and it is what makes the lookup safe. Without it,
  -- two calls that arrive together both see zero memberships and both create a kitchen, so
  -- the cook ends up with two. This is not theoretical: React's StrictMode runs an effect
  -- twice in development, and the caller here is exactly such an effect. The lock is
  -- transaction-scoped, so it releases on its own when the transaction ends and nothing has
  -- to unlock it.
  perform pg_advisory_xact_lock(hashtextextended(v_user::text, 0));

  -- Returning EARLY is what makes this idempotent and safe to call on every load. It also
  -- self-heals: a cook who leaves every family gets a kitchen back rather than falling into
  -- the dead-button state.
  select family_id into v_family from family_members where user_id = v_user limit 1;
  if v_family is not null then
    return v_family;
  end if;

  select kitchen_name(display_name) into v_name from profiles where id = v_user;

  insert into families (name, created_by) values (v_name, v_user) returning id into v_family;
  insert into family_members (family_id, user_id, role) values (v_family, v_user, 'owner');

  return v_family;
end; $$;

-- PUBLIC first, then anon. Postgres grants execute to PUBLIC on every new function, and
-- revoking from anon alone does NOT undo that: anon would still reach it through PUBLIC.
-- The integration test asserts the anon caller gets 42501 specifically, so if this pair of
-- revokes is ever dropped the test goes red rather than quietly passing.
revoke execute on function ensure_own_kitchen() from public;
revoke execute on function ensure_own_kitchen() from anon;
grant execute on function ensure_own_kitchen() to authenticated;

-- The backfill. This is what repairs accounts that ALREADY exist, including the test account
-- that found this defect: the function above only helps a cook who loads the app again, and
-- an account that is already in the dead-button state has no way to ask for a kitchen.
--
-- It uses the SAME naming rule as the function, deliberately, so a backfilled kitchen and a
-- freshly created one are indistinguishable. Written to be safe to run once (a migration
-- runs once) and harmless if it matches nothing, which is the case on a fresh database where
-- every profile already has a membership.
-- No loop and no branch: kitchen_name above is the only place the rule lives, so this is two
-- set-based inserts. The second one reads back the rows the first just wrote, which is why
-- created_by is the join key: it is the only column tying a new family to the cook it is for.
with new_families as (
  insert into families (name, created_by)
  select kitchen_name(p.display_name), p.id
    from profiles p
   where not exists (select 1 from family_members m where m.user_id = p.id)
  returning id, created_by
)
insert into family_members (family_id, user_id, role)
select id, created_by, 'owner' from new_families;
