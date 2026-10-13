-- 0058: "no such recipe" was the answer for a recipe that plainly exists.
--
-- Audit note first, because the absence of a finding is worth recording as loudly as a
-- finding. `recipe_drafts.target_recipe_id` is unconstrained by `drafts_insert`, which is the
-- exact shape `0053` closed on `appeals.subject_id`, and it is NOT a hole here:
-- `publish_recipe_edit` is SECURITY INVOKER, so `recipes_update` still decides. It fails
-- closed earlier than it looks, too, and the reason is subtle enough to be worth writing down:
--
--   **`SELECT ... FOR UPDATE` applies the UPDATE policy, not only the SELECT policy.**
--
-- So the lock at the top of the function is already an authorisation check. A cook who may
-- read a recipe but not write it (a family MEMBER: `recipes_read` admits every member,
-- `recipes_update` admits the author or the family's owner) finds no row to lock, and the
-- function raises before it updates anything, before it touches the children, and before it
-- deletes the draft. Nothing is lost and nothing is written. That was measured, as an ordinary
-- member against a real database, rather than reasoned about.
--
-- WHAT IS WRONG IS WHAT IT SAYS. That cook is told "no such recipe" about a recipe they are
-- at that moment looking at. This project's standing rule is that a page must not lie, and an
-- error message is the page talking. The two cases are distinguishable: a row that cannot be
-- locked but can still be READ exists and is simply not theirs to edit.
--
-- The repaired message is the only change. RESTATED IN FULL from 0033 otherwise, for the
-- reason this repo gives every time: redefining a function and silently losing part of it is
-- how migration 0009 came to exist.
create or replace function publish_recipe_edit(p_draft uuid, p_force boolean default false)
returns uuid language plpgsql set search_path = public as $$
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
  --
  -- It is ALSO the permission check, because a locking SELECT is governed by the UPDATE
  -- policy: see the header. Do not "simplify" it to a plain SELECT. That would not only lose
  -- the lock, it would carry the function past this point for a cook who may not write the
  -- row, to an UPDATE that row-level security answers with zero rows and no error, and then
  -- on to deleting their draft and reporting a successful publish.
  select updated_at into v_current from recipes where id = v_target for update;
  if not found then
    -- NEW in 0058: which refusal this is. A row that cannot be LOCKED may still be READABLE,
    -- and those are two different sentences to the person reading them.
    if exists (select 1 from recipes where id = v_target) then
      raise exception 'you cannot edit that recipe' using errcode = 'insufficient_privilege';
    end if;
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
