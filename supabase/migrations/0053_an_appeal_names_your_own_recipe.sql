-- 0053: an appeal may only name the appellant's OWN recipe.
--
-- `appeal_insert` (0035) checked only `cook_id = auth.uid()`. `subject_id` was unconstrained,
-- so a cook could insert `subject_type = 'recipe'` naming ANY recipe id, and `resolve_appeal`
-- grants a recipe appeal by clearing `removed_at` on whatever the row names. A moderator
-- granting what the queue renders as "A removed recipe" therefore undid a takedown on a
-- recipe the appellant had nothing to do with. There was no human check behind the policy
-- either: the queue shows the appellant, the subject label and the recipe's title, and
-- nothing that would tell a moderator the two are unrelated.
--
-- Identity on the owner column is NOT the same as authority over the subject. That is the
-- shape worth remembering here: every other insert policy in this schema keyed the same way
-- (`report_insert`, `terms_insert_own`) is correct only because its rows carry no second id
-- that something later acts on.
--
-- No UI ever filed a 'recipe' or a 'suspension' appeal: `src/pages/Settings.tsx` files 'name'
-- with a null subject and is the only caller of `createAppeal`, so this was reachable only by
-- a hand-made request and every stored row is already consistent with the constraint below.

-- The pair must match: a recipe appeal carries its recipe, the other two carry null, which is
-- what 0035's own column comment says and nothing enforced. It is load bearing beyond
-- tidiness: `appeals_one_open_per_subject` is the one-open-per-cook rule for 'name' and
-- 'suspension' ONLY because their subject is null (that is what NULLS NOT DISTINCT acts on),
-- so a 'name' appeal carrying a junk subject_id escaped that index as well.
alter table appeals add constraint appeals_subject_matches_type
  check ((subject_type = 'recipe') = (subject_id is not null));

-- security definer, and tied to auth.uid() in the same expression that reads the row.
--
-- READ THIS BEFORE INLINING IT BACK INTO THE POLICY. An insert policy cannot answer this with
-- a plain `exists (select 1 from recipes ...)`: `recipes_read` (0003) applies inside the
-- subquery, so it answers "can I SEE this recipe", not "is it mine". `take_down_recipe`
-- (0028) sets `visibility = 'family'`, so a removed recipe stays readable to every OTHER
-- member of the author's family, and the guard would have passed for all of them. Same trap
-- `name_cleared_and_unset` documents at the top of 0035.
--
-- It returns a plain boolean and never reveals anything else about the recipe, and `exists`
-- cannot return NULL, so a negated use of it cannot fail open the way 0049's gate did.
create or replace function own_recipe(p_recipe uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from recipes r where r.id = p_recipe and r.author_id = auth.uid());
$$;

revoke execute on function own_recipe(uuid) from public;
revoke execute on function own_recipe(uuid) from anon;
grant execute on function own_recipe(uuid) to authenticated;

-- RESTATED IN FULL from 0035, with the subject clause added. `cook_id = auth.uid()` is
-- carried over verbatim.
drop policy appeal_insert on appeals;
create policy appeal_insert on appeals for insert
  with check (
    cook_id = auth.uid()
    and (subject_type <> 'recipe' or own_recipe(subject_id))
  );

-- RESTATED IN FULL from 0035, with one guard added inside the 'recipe' branch. Everything
-- else is carried over VERBATIM, for the reason 0035 itself gives: this repo has been bitten
-- twice by redefining something and silently losing part of it.
--
-- The guard is a SECOND lock and deliberately not a move. The insert policy is what stops a
-- foreign recipe being named; this is what stops one that was named before that policy
-- existed, or by any future path that writes the row another way. A definer function that
-- performs an undo on an id it was handed must check that id itself.
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
      -- NEW in 0053. `is distinct from`, not `<>`: a subject whose recipe row is gone gives
      -- NULL, and `NULL <> v_cook` is NULL, which plpgsql skips, so the negated test would
      -- not fire for exactly the rows it is for. That is the 0049 shape.
      if (select author_id from recipes where id = v_subject) is distinct from v_cook then
        raise exception 'that recipe is not this cook''s'
          using errcode = 'insufficient_privilege';
      end if;
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

-- PUBLIC first, then anon. `create or replace` keeps the existing grants, but restating them
-- costs nothing and a future `drop`/`create` pair here would otherwise silently hand the
-- function back to PUBLIC.
revoke execute on function resolve_appeal(uuid, text, text) from public;
revoke execute on function resolve_appeal(uuid, text, text) from anon;
grant execute on function resolve_appeal(uuid, text, text) to authenticated;
