-- 0034: publishing a pending edit to a recipe that is already live.
--
-- 5a stores an unfinished recipe that does not exist yet: nobody can be reading it, nothing
-- points at it, and finishing it is an insert. An edit to a LIVE recipe is none of those
-- things. The recipe is on screen for other people, it may be public, and someone may be
-- cooking from it right now, so finishing is a merge against a row that can have moved
-- underneath the draft.
--
-- The decision, settled in the spec: warn, then let the cook choose. Not silent
-- last-write-wins, which is what editing does today and what would quietly destroy someone's
-- work, and not a lock, which a forgotten draft would hold forever.

-- Nullable, because a 5a create draft has no recipe to be stale against. Null means this
-- draft is a NEW recipe (5a) rather than an edit. When it is not null it holds the target
-- recipe's updated_at at the moment the edit was started, which is the only thing the
-- comparison below needs.
alter table recipe_drafts add column base_updated_at timestamptz;

-- security invoker on purpose: recipes_update must keep deciding who may edit, so this
-- function widens the QUERY and never the permissions. It is the same stance as
-- save_recipe_to_vault in 0027 and search_recipes in 0025. A definer version would let any
-- cook publish an edit to any recipe, which is exactly the rule the policy exists to state.
--
-- What this function deliberately does NOT do: it writes no guard about taken-down recipes.
-- enforce_publish_rules from 0028 is a TRIGGER on recipes, so it already fires on the update
-- below without this function knowing the rule exists. A second check here would be a second
-- source of truth for the same rule, and the repo has paid twice for that (0009 and 0019
-- both exist because a rule lived in two places and one copy was forgotten).
create function publish_recipe_edit(p_draft uuid, p_force boolean default false)
returns uuid language plpgsql security invoker set search_path = public as $$
declare
  v_target uuid;
  v_base timestamptz;
  v_title text;
  v_body jsonb;
  v_current timestamptz;
begin
  -- RLS already restricts this row to its author, so a draft belonging to someone else is
  -- simply not found rather than refused by a check written here.
  select target_recipe_id, base_updated_at, title, body
    into v_target, v_base, v_title, v_body
    from recipe_drafts where id = p_draft;
  if not found then
    raise exception 'no such draft' using errcode = 'no_data_found';
  end if;

  -- Publishing a create draft is not this path. 5a finishes by inserting a recipe, and
  -- routing it through here would mean inventing a family and an author for a row that
  -- already has both.
  if v_target is null then
    raise exception 'this draft is a new recipe, not an edit'
      using errcode = 'invalid_parameter_value';
  end if;

  -- The FOR UPDATE lock is what makes the check and the write atomic. Checking in the client
  -- and then writing is a race with a smaller window, not a fix, and the window is exactly
  -- when two people are editing, which is the only time any of this matters.
  select updated_at into v_current from recipes where id = v_target for update;
  if not found then
    raise exception 'no such recipe' using errcode = 'no_data_found';
  end if;

  -- DRF01 is a CUSTOM SQLSTATE, and the custom part is load bearing. The obvious choice was
  -- serialization_failure (40001), but that class means "transient, try again" to everything
  -- above Postgres: PostgREST retries it, so the refusal never reached the caller and the
  -- integration test hung for the full 30 second timeout instead of failing. A code the
  -- stack ascribes no meaning to is the only one that survives the trip.
  -- The client offers "publish
  -- anyway" only for this and must not offer it for a real failure.
  if not p_force and v_current is distinct from v_base then
    raise exception 'the recipe changed since this edit was started'
      using errcode = 'DRF01';
  end if;

  -- Scalars are read out of body with ->> and cast, and a missing key reads as null. body is
  -- schemaless by design (see 0033), so every field in it is optional and a draft written
  -- before a field existed must still publish.
  update recipes set
    title = v_title,
    story = v_body->>'story',
    provenance = v_body->>'provenance',
    servings = (v_body->>'servings')::int,
    prep_minutes = (v_body->>'prep_minutes')::int,
    cook_minutes = (v_body->>'cook_minutes')::int,
    visibility = (v_body->>'visibility')::recipe_visibility,
    source_url = v_body->>'source_url',
    updated_at = now()
  where id = v_target;

  -- The EXISTING function, never a second copy of that logic. Its own comment records that a
  -- hand-written column list has silently dropped a column twice (0009 and 0019), and a
  -- publish path that reimplemented the insert would be the third.
  perform replace_recipe_children(v_target, v_body->'ingredients', v_body->'steps');

  -- After the write, deliberately. A failed delete leaves a stale draft, which the cook can
  -- see and publish again; the other order loses the work.
  delete from recipe_drafts where id = p_draft;

  return v_target;
end; $$;

-- PUBLIC first, then anon. Postgres grants execute to PUBLIC on every new function, and
-- revoking from anon alone does NOT undo that: anon would still reach it through PUBLIC.
-- Same pair as 0032, for the same reason.
revoke execute on function publish_recipe_edit(uuid, boolean) from public;
revoke execute on function publish_recipe_edit(uuid, boolean) from anon;
grant execute on function publish_recipe_edit(uuid, boolean) to authenticated;
