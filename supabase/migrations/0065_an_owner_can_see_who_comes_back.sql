-- 0065: the people and access half of a group's numbers, for its owner and nobody else.
--
-- Designed in docs/superpowers/specs/2026-10-21-kitchen-measurement-design.md. The rule that
-- decides what is in here rather than in 0063 is "you see numbers for the things you can act
-- on". A chef creates dishes, sends them to trial and signs them off, so every throughput
-- figure is theirs as much as the owner's. Nobody but an owner issues an invite, sets a role,
-- removes staff, closes a site or erases the group, so the figures about PEOPLE and ACCESS have
-- no other reader who could do anything with them.
--
-- A SEPARATE FUNCTION RATHER THAN A SECOND BRANCH INSIDE group_numbers, deliberately. A chef
-- must not RECEIVE these rows at all, rather than receive them and be trusted not to render
-- them, and the cheapest way to guarantee that is for the payload a chef asks for never to
-- contain them. It also keeps each function to one gate, so neither gate has to be read in the
-- light of the other.
--
-- THE GATE IS A POSITIVE EQUALITY TEST, for the reason 0063's header sets out at length:
-- kitchen.staff_role() is a bare select and returns NULL for a non-member, and a negated test
-- against NULL skips its own refusal. The work is inside the branch and the function ends with
-- the empty object, so every reader who is not the owner, NULL included, leaves with nothing.
create function kitchen.group_people(p_org uuid) returns jsonb
language plpgsql stable security definer set search_path = kitchen, public as $$
declare
  v_staff jsonb;
  v_invites jsonb;
begin
  if kitchen.staff_role(p_org) = 'owner' then

    -- THE STAFF LIST IS THE GROUP'S CURRENT STAFF, and the attendance is read by joining to it
    -- rather than the other way round. Two consequences, both intended: somebody who has been
    -- removed from the group is not listed, and their rows are not destroyed either, so putting
    -- them back shows their history again. Nothing in this feature ever deletes an attendance
    -- row; only the two cascades in 0064 do.
    select coalesce(jsonb_agg(jsonb_build_object(
             'user_id', st.user_id,
             'display_name', st.display_name,
             'role', st.role,
             -- Null for group-wide staff, which is the normal case for an owner or a chef.
             'site_name', s.name,
             'days_back', w.days_back,
             'of_days', w.of_days,
             -- The LAST day they were here, over all time rather than inside the window: "last
             -- seen" has to mean last seen, or a figure of 0 of 7 would come with no date at
             -- all for somebody who was here a fortnight ago.
             'last_seen', (select max(ad.day) from kitchen.activity_days ad
                            where ad.org_id = p_org and ad.user_id = st.user_id),
             -- NEVER OPENED IT IS THE ABSENCE OF ANY ROW, EVER, and it is a state of its own
             -- rather than days_back = 0. Somebody who joined yesterday and has not arrived is
             -- not the same as somebody who stopped coming, and an owner acting on the two
             -- would do different things.
             'never', not exists (select 1 from kitchen.activity_days ad
                                   where ad.org_id = p_org and ad.user_id = st.user_id))
           order by st.display_name), '[]'::jsonb)
      into v_staff
      from kitchen.staff st
      left join kitchen.sites s on s.id = st.site_id
      -- THE DENOMINATOR IS DAYS SINCE JOINING, CAPPED AT SEVEN. Aayush's decision, and the
      -- reason is that "back 1 of 7 days" reads as four days of absence for somebody who
      -- started on Friday. The floor of 1 is what keeps somebody who joined today from being
      -- reported as 0 of 0, which is not a figure. The window the numerator counts is the same
      -- one the denominator names, so the pair can always be read as a fraction.
      left join lateral (
        select
          least(7, greatest(1, current_date - st.joined_at::date)) as of_days,
          (select count(distinct ad.day)
             from kitchen.activity_days ad
            where ad.org_id = p_org
              and ad.user_id = st.user_id
              -- A day, not a visit: somebody who opened four pages this morning was here once.
              -- count(distinct day) is what makes that true, and the page says "days" for the
              -- same reason.
              and ad.day > current_date - least(7, greatest(1, current_date - st.joined_at::date))
          ) as days_back
      ) w on true
     where st.org_id = p_org;

    -- An invite carries its own expires_at (0054), so an aged-out invite is one that was never
    -- used and whose lifetime has run out. Counting from created_at would be a second opinion
    -- about the lifetime, and the column is the first.
    select jsonb_build_object(
             'issued', count(*),
             'used', count(*) filter (where used_at is not null),
             'open', count(*) filter (where used_at is null and expires_at > now()),
             'aged_out', count(*) filter (where used_at is null and expires_at <= now()))
      into v_invites
      from kitchen.staff_invites i
     where i.org_id = p_org;

    return jsonb_build_object(
      'staff', v_staff,
      'invites', v_invites,
      -- Closing and retiring are owner-only acts (0061), so their counts belong here rather
      -- than beside the throughput figures a chef also reads.
      'closed_sites', (select count(*) from kitchen.sites
                        where org_id = p_org and closed_at is not null),
      'retired_dishes', (select count(*) from kitchen.dishes
                          where org_id = p_org and retired_at is not null));
  end if;

  -- Not the owner. A chef, a site_manager, a cook, a former member and a stranger all get this.
  return '{}'::jsonb;
end; $$;

-- The trailer every migration in this schema has ended with since 0049. Revoking without the
-- re-grant takes execute away from `authenticated` too, which 0063 proved with a 42501.
revoke execute on all functions in schema kitchen from public, anon;
grant execute on all functions in schema kitchen to authenticated, service_role;
grant execute on function kitchen.peek_invite(text) to anon;
