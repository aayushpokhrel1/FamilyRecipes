-- 0042: the transitions, and the one query the whole product exists to answer.
--
-- A dish at trial CAN be revised and the trial site sees the new version: freezing on trial
-- would stop a chef responding to the notes coming back, which is the point of a trial.
-- A dish on the menu can also be revised, and the menu keeps showing the APPROVED version
-- until somebody signs the new one off. Those two sentences are the design; menu_version is
-- where they are enforced.
create table kitchen.approvals (
  version_id uuid primary key references kitchen.dish_versions(id) on delete cascade,
  approved_by uuid not null references auth.users(id),
  approved_at timestamptz not null default now()
);
alter table kitchen.approvals enable row level security;
create policy approvals_read on kitchen.approvals for select using (exists (
  select 1 from kitchen.dish_versions v
  where v.id = version_id and kitchen.can_read_dish(v.dish_id)));
grant select, insert, update, delete on kitchen.approvals to authenticated, service_role;

create function kitchen.send_to_trial(p_dish uuid, p_site uuid) returns void
language plpgsql security definer set search_path = kitchen, public as $$
declare v_org uuid; v_stage kitchen.dish_stage;
begin
  select org_id, stage into v_org, v_stage from kitchen.dishes where id = p_dish;
  if v_org is null then
    raise exception 'no such dish' using errcode = 'KIT04';
  end if;
  if kitchen.staff_role(v_org) not in ('owner','chef') then
    raise exception 'only an owner or a chef may send a dish to trial' using errcode = 'KIT01';
  end if;
  if v_stage <> 'development' then
    raise exception 'that dish is not in development' using errcode = 'KIT02';
  end if;
  if not exists (select 1 from kitchen.sites where id = p_site and org_id = v_org) then
    raise exception 'that site belongs to another org' using errcode = 'KIT04';
  end if;
  update kitchen.dishes set stage = 'trial', trial_site_id = p_site where id = p_dish;
end; $$;

create function kitchen.sign_off(p_version uuid) returns void
language plpgsql security definer set search_path = kitchen, public as $$
declare v_dish uuid; v_org uuid; v_stage kitchen.dish_stage;
begin
  select v.dish_id, d.org_id, d.stage into v_dish, v_org, v_stage
  from kitchen.dish_versions v join kitchen.dishes d on d.id = v.dish_id
  where v.id = p_version;
  if v_dish is null then
    raise exception 'no such version' using errcode = 'KIT04';
  end if;
  if kitchen.staff_role(v_org) not in ('owner','chef') then
    raise exception 'only an owner or a chef may sign a dish off' using errcode = 'KIT01';
  end if;
  -- A dish goes to the menu from trial, not straight from development. The whole product is
  -- that somebody cooked it somewhere before three sites were told to.
  if v_stage = 'development' then
    raise exception 'trial that dish at a site first' using errcode = 'KIT02';
  end if;
  insert into kitchen.approvals (version_id, approved_by) values (p_version, auth.uid())
    on conflict (version_id) do nothing;
  update kitchen.dishes set stage = 'menu', trial_site_id = null where id = v_dish;
end; $$;

-- What three sites are actually cooking: the latest APPROVED version, which is not the
-- latest version. Reading `max(n)` here would be the bug this function exists to prevent.
create function kitchen.menu_version(p_dish uuid) returns uuid
language sql stable security definer set search_path = kitchen, public as $$
  select v.id
  from kitchen.dish_versions v
  join kitchen.approvals a on a.version_id = v.id
  where v.dish_id = p_dish and kitchen.can_read_dish(p_dish)
  order by a.approved_at desc
  limit 1;
$$;
