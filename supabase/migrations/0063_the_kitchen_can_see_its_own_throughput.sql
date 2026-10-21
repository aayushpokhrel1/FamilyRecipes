-- 0063: a kitchen group can see whether its dishes land, where it stalls, and which of its
-- sites are real.
--
-- Designed in docs/superpowers/specs/2026-10-21-kitchen-measurement-design.md. Note what is
-- NOT here: a table. Every figure below is arithmetic over timestamps this schema already
-- keeps, which is why this is not 0060 with the tables renamed. The one thing the kitchen
-- records nowhere, whether a person comes back, needs storage and arrives in 0064.
--
-- THE GATE IS WRITTEN POSITIVELY, and that is the whole security design of this file.
-- kitchen.staff_role() is a bare select, so it returns NULL for somebody who is not staff at
-- all. The form used elsewhere in this schema, `if staff_role(...) not in ('owner','chef')
-- then raise`, is NULL for that caller, and plpgsql SKIPS an IF body whose condition is NULL,
-- so the refusal never fires: that is the bug a 2026-10-12 audit found, where a user whose
-- staff row had been deleted could sign a dish onto the live menu while a cook could not.
-- Here the work is INSIDE the positive branch and the function ends with the empty object, so
-- a NULL role falls through to "you are served nothing" by construction rather than by a
-- check someone has to remember to write. supabase/rls.test.ts fails the negated shape.
--
-- WHY jsonb RATHER THAN A COMPOSITE OR A SET OF ROWS. The page asks one question and draws
-- three blocks of different shapes from the answer, so one round trip returning one document
-- beats three functions or a flattened row that the client has to reassemble. The client's
-- types in src/lib/api/kitchen/types.ts mirror these keys exactly.
--
-- `stable`, not `volatile`: nothing here writes, and the planner may cache within a statement.

-- EVERY FIGURE IS ALL-TIME, except the one that names its own window. A group with twelve
-- dishes has no thirty-day story, and a rolling window would move the headline number for
-- reasons nobody in the kitchen did anything about.
create function kitchen.group_numbers(p_org uuid) returns jsonb
language plpgsql stable security definer set search_path = kitchen, public as $$
declare
  v_dishes jsonb;
  v_funnel jsonb;
  v_sites jsonb;
begin
  -- The positive gate. A site_manager, a cook, a former staff member and a stranger all leave
  -- with the same empty object, which is also what the client reads as "you are not served
  -- this" rather than as "this group has nothing in it".
  if kitchen.staff_role(p_org) in ('owner', 'chef') then

    -- One pass over the group's dishes, carrying the two dates every figure below needs.
    -- FIRST version and FIRST approval, not the latest of either: approvals is keyed by
    -- version_id, so a dish revised and re-approved has several, and the question this
    -- answers is "did it land, and how long did that take", which the first signature is the
    -- only honest answer to.
    with d as (
      select
        dsh.id,
        dsh.title,
        dsh.stage,
        (select min(dv.created_at) from kitchen.dish_versions dv where dv.dish_id = dsh.id)
          as first_version,
        (select min(a.approved_at)
           from kitchen.approvals a
           join kitchen.dish_versions dv on dv.id = a.version_id
          where dv.dish_id = dsh.id) as first_approval
      from kitchen.dishes dsh
      where dsh.org_id = p_org
    )
    select
      jsonb_build_object(
        -- A dish row is a started dish, which is what the moderator console already counts,
        -- so the two cannot disagree about the denominator.
        'started', count(*),
        'landed', count(first_approval),
        -- percentile_cont over an empty set is NULL, which is the honest answer for a group
        -- that has landed nothing and is why there is no coalesce here. A dish with no
        -- version contributes nothing to this: its interval is NULL and the aggregate skips
        -- it, so it is counted as started and nowhere else.
        'median_days', round(
          percentile_cont(0.5) within group (
            order by extract(epoch from (first_approval - first_version)) / 86400.0
          )::numeric, 1),
        -- An unlanded dish whose first version is over a month old, newest first. coalesce to
        -- an empty array rather than null, so the page can map over it without a guard.
        'slow', coalesce(
          (select jsonb_agg(jsonb_build_object(
                    'id', s.id, 'title', s.title,
                    'days', floor(extract(epoch from (now() - s.first_version)) / 86400.0))
                  order by s.first_version desc)
             from d s
            where s.first_approval is null
              and s.first_version is not null
              and s.first_version < now() - interval '1 month'),
          '[]'::jsonb)
      ),
      jsonb_build_object(
        'dishes', count(*),
        'with_version', count(first_version),
        -- A dish that has been signed off is at stage 'menu' and its trial_site_id has been
        -- CLEARED (0042), so "was it ever trialled" cannot be read from trial_site_id. It can
        -- be read from the stage, because sign_off refuses a dish that is still in
        -- development: reaching 'menu' means it passed through trial. If a later migration
        -- ever lets a dish skip trial, this line stops being true and must be revisited.
        'trialled', count(*) filter (where stage in ('trial', 'menu')),
        'landed', count(first_approval),
        -- Signed off is not published. The last step is a live row in published_snapshots,
        -- which is one row per dish (0044) with unpublished_at set when it is pulled (0061).
        'on_menu', (select count(*)
                      from kitchen.published_snapshots ps
                      join kitchen.dishes pd on pd.id = ps.dish_id
                     where pd.org_id = p_org and ps.unpublished_at is null)
      )
    into v_dishes, v_funnel
    from d;

    -- A site that has recorded nothing is a row somebody typed. `trials` is the number of
    -- dishes on trial there NOW, not ever, for the same reason as above: the column is
    -- cleared on sign-off. `last_recorded` is the only history a site has, and it comes from
    -- the deviations, which are never cleared.
    select coalesce(jsonb_agg(jsonb_build_object(
             'id', s.id,
             'name', s.name,
             'substitutions', (select count(*) from kitchen.deviations dv where dv.site_id = s.id),
             'trials', (select count(*) from kitchen.dishes td where td.trial_site_id = s.id),
             'last_recorded', (select max(dv.created_at) from kitchen.deviations dv
                                where dv.site_id = s.id),
             'added', s.created_at,
             'closed', s.closed_at is not null)
           order by s.name), '[]'::jsonb)
      into v_sites
      from kitchen.sites s
     where s.org_id = p_org;

    return jsonb_build_object('dishes', v_dishes, 'funnel', v_funnel, 'sites', v_sites);
  end if;

  -- Not served. The same answer for every role that is not owner or chef, including NULL.
  return '{}'::jsonb;
end; $$;

-- The strip on "Your kitchens", which lists several groups at once.
--
-- NO ARGUMENT, DELIBERATELY. One call returns a row per group the caller runs, so the list
-- page makes one request rather than one per group, and there is no id for a caller to
-- substitute: rls.test.ts's rule about a definer function taking a uuid cannot be broken by a
-- function that takes none. The subject is auth.uid() and nothing else.
create function kitchen.my_group_numbers() returns jsonb
language plpgsql stable security definer set search_path = kitchen, public as $$
declare v jsonb;
begin
  -- Anonymous callers have no groups. A no-op rather than an error: this runs on a page load.
  if auth.uid() is null then
    return '{}'::jsonb;
  end if;

  -- The role filter IS the gate here, and it is positive for the same reason as above: the
  -- `in` list selects the rows that may be reported rather than excluding the ones that may
  -- not, so a role nobody thought of is absent instead of included.
  --
  -- The three figures repeat group_numbers' definitions. They are deliberately not factored
  -- out into a third function: the strip must be the same numbers as the page, and the way to
  -- guarantee that is one definition of each figure, which is what this duplication does
  -- NOT give. If a third figure is added, change both, and the integration test that compares
  -- them is tests/integration/kitchen_numbers.test.ts.
  select coalesce(jsonb_object_agg(x.org_id, jsonb_build_object(
           'started', x.started, 'landed', x.landed, 'median_days', x.median_days)), '{}'::jsonb)
    into v
    from (
      select
        st.org_id,
        count(dsh.id) as started,
        count(fa.first_approval) as landed,
        round(percentile_cont(0.5) within group (
          order by extract(epoch from (fa.first_approval - fv.first_version)) / 86400.0
        )::numeric, 1) as median_days
      from kitchen.staff st
      left join kitchen.dishes dsh on dsh.org_id = st.org_id
      left join lateral (
        select min(dv.created_at) as first_version
          from kitchen.dish_versions dv where dv.dish_id = dsh.id) fv on true
      left join lateral (
        select min(a.approved_at) as first_approval
          from kitchen.approvals a
          join kitchen.dish_versions dv on dv.id = a.version_id
         where dv.dish_id = dsh.id) fa on true
      where st.user_id = auth.uid()
        and st.role in ('owner', 'chef')
      group by st.org_id
    ) x;

  return v;
end; $$;

-- The same three-line trailer every migration in this schema since 0049 ends with, and it is
-- three lines rather than two targeted revokes for a reason this file proved by getting it
-- wrong first: Postgres's default is EXECUTE to PUBLIC, so a new function has to be revoked,
-- but `authenticated` reaches these functions THROUGH that same PUBLIC grant, because 0039's
-- `grant execute on all functions` covered only the functions that existed when it ran. Revoke
-- without the re-grant and every signed-in caller gets 42501 instead of their own numbers,
-- which is what the integration test reported before this block was copied from 0061.
-- Blanket-wise, because that is the only form that also covers the function nobody has
-- written yet.
revoke execute on all functions in schema kitchen from public, anon;
grant execute on all functions in schema kitchen to authenticated, service_role;
-- peek_invite stays reachable by anon: a stranger has to be able to read what an invite is
-- for before signing up to accept it. 0061 and 0062 carry the same line for the same reason.
grant execute on function kitchen.peek_invite(text) to anon;
