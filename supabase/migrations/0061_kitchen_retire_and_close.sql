-- 0061: a dish can be retired, and a site can be closed.
--
-- RETIREMENT AND PUBLICATION ARE SEPARATE AXES, and keeping them separate is the whole
-- design of this file. Retirement is about the GROUP'S OWN MENU: a dish nobody cooks any
-- more stops being a thing a chef can send to trial or sign onto the menu, so the kitchen
-- stops offering it. Publication is about the PUBLIC: a snapshot of one approved version
-- already sits in Potluck under the venue's name, and whether the group still cooks it
-- today is not a statement about whether that page should exist. So `publish_dish` and
-- `unpublish_dish` are deliberately NOT touched here and a retired dish can still be
-- published. An owner who wants the page gone has `unpublish_dish`, which is a different
-- act with a different audience, and conflating the two would mean retiring a dish silently
-- broke a link somebody already sent.
--
-- CLOSING A SITE MOVES ITS TRIALS HOME BEFORE IT STAMPS `closed_at`, and the order is forced
-- by the schema rather than chosen. `kitchen.dishes` carries
-- `constraint trial_site_iff_trial check ((stage = 'trial') = (trial_site_id is not null))`,
-- so a dish at trial must name a site and a dish anywhere else must not. Clearing
-- `trial_site_id` on its own violates that constraint, and so does moving the stage on its
-- own; stage and site have to move together, in ONE statement, and that statement has to run
-- before the site is stamped closed. Retired dishes are included in that update on purpose:
-- a retired dish that is still out at trial has to come home too, or the constraint fires
-- when the site closes and the close fails for a reason nobody would guess.
--
-- ONLY COOKS AND SITE MANAGERS LOSE THEIR `site_id`. A chef's or an owner's null site_id
-- already means GROUP-WIDE (0039), so nulling it would be a no-op at best and a lie at
-- worst; a cook's or a site manager's site_id is the only thing that says which site they
-- work at, and that site no longer exists. They keep their staff row and their role, and
-- they read nothing until somebody assigns them to another site, which is the same strict
-- behaviour 0039 documents for a member with no site.
--
-- Reopening a site deliberately does NOT restore the dishes or the staff assignments that
-- closing moved. Those have been free to change since, and putting them back would overwrite
-- a chef's decision made in the meantime with a guess about what used to be true.

alter table kitchen.dishes add column retired_at timestamptz;
alter table kitchen.sites add column closed_at timestamptz;

-- `coalesce` is mandatory on every gate below, not stylistic. `kitchen.staff_role(org)` is a
-- bare SELECT, so it returns NULL for a caller with no staff row, and `NULL not in (...)` is
-- NULL, which plpgsql skips. A bare `not in` would therefore refuse every wrong role and
-- admit the absence of a role, which is the HIGH 0049 was written for. supabase/rls.test.ts
-- fails the build on that shape.
create function kitchen.retire_dish(p_dish uuid) returns void
language plpgsql security definer set search_path = kitchen, public as $$
declare v_org uuid; v_retired_at timestamptz;
begin
  select org_id, retired_at into v_org, v_retired_at from kitchen.dishes where id = p_dish;
  if v_org is null then
    raise exception 'no such dish' using errcode = 'KIT04';
  end if;
  if coalesce(kitchen.staff_role(v_org), '') not in ('owner','chef') then
    raise exception 'only an owner or a chef may retire a dish' using errcode = 'KIT01';
  end if;
  if v_retired_at is not null then
    raise exception 'that dish is already retired' using errcode = 'KIT02';
  end if;
  update kitchen.dishes set retired_at = now() where id = p_dish;
end; $$;

-- The way back, with the same roles. Retirement is not a deletion: nothing is removed, the
-- versions and the approvals stay exactly where they are, and unretiring puts the dish back
-- on the menu it was on.
create function kitchen.unretire_dish(p_dish uuid) returns void
language plpgsql security definer set search_path = kitchen, public as $$
declare v_org uuid; v_retired_at timestamptz;
begin
  select org_id, retired_at into v_org, v_retired_at from kitchen.dishes where id = p_dish;
  if v_org is null then
    raise exception 'no such dish' using errcode = 'KIT04';
  end if;
  if coalesce(kitchen.staff_role(v_org), '') not in ('owner','chef') then
    raise exception 'only an owner or a chef may unretire a dish' using errcode = 'KIT01';
  end if;
  if v_retired_at is null then
    raise exception 'that dish is not retired' using errcode = 'KIT02';
  end if;
  update kitchen.dishes set retired_at = null where id = p_dish;
end; $$;

-- The two pipeline refusals. Both bodies are 0049's verbatim, with ONE check added after the
-- role gate and before the stage gate: a retired dish cannot be sent to trial or signed onto
-- the menu. Nothing else in either function changes.
create or replace function kitchen.send_to_trial(p_dish uuid, p_site uuid) returns void
language plpgsql security definer set search_path = kitchen, public as $$
declare v_org uuid; v_stage kitchen.dish_stage; v_retired_at timestamptz;
begin
  select org_id, stage, retired_at into v_org, v_stage, v_retired_at
  from kitchen.dishes where id = p_dish;
  if v_org is null then
    raise exception 'no such dish' using errcode = 'KIT04';
  end if;
  if coalesce(kitchen.staff_role(v_org), '') not in ('owner','chef') then
    raise exception 'only an owner or a chef may send a dish to trial' using errcode = 'KIT01';
  end if;
  if v_retired_at is not null then
    raise exception 'that dish is retired' using errcode = 'KIT02';
  end if;
  if v_stage <> 'development' then
    raise exception 'that dish is not in development' using errcode = 'KIT02';
  end if;
  if not exists (select 1 from kitchen.sites where id = p_site and org_id = v_org) then
    raise exception 'that site belongs to another org' using errcode = 'KIT04';
  end if;
  update kitchen.dishes set stage = 'trial', trial_site_id = p_site where id = p_dish;
end; $$;

create or replace function kitchen.sign_off(p_version uuid) returns void
language plpgsql security definer set search_path = kitchen, public as $$
declare v_dish uuid; v_org uuid; v_stage kitchen.dish_stage; v_retired_at timestamptz;
begin
  select v.dish_id, d.org_id, d.stage, d.retired_at into v_dish, v_org, v_stage, v_retired_at
  from kitchen.dish_versions v join kitchen.dishes d on d.id = v.dish_id
  where v.id = p_version;
  if v_dish is null then
    raise exception 'no such version' using errcode = 'KIT04';
  end if;
  if coalesce(kitchen.staff_role(v_org), '') not in ('owner','chef') then
    raise exception 'only an owner or a chef may sign a dish off' using errcode = 'KIT01';
  end if;
  if v_retired_at is not null then
    raise exception 'that dish is retired' using errcode = 'KIT02';
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

-- Owner only, because closing a site is a decision about the business rather than about a
-- kitchen: it takes a site out of every chef's reach at once.
create function kitchen.close_site(p_site uuid) returns void
language plpgsql security definer set search_path = kitchen, public as $$
declare v_org uuid; v_closed_at timestamptz;
begin
  select org_id, closed_at into v_org, v_closed_at from kitchen.sites where id = p_site;
  if v_org is null then
    raise exception 'no such site' using errcode = 'KIT04';
  end if;
  if coalesce(kitchen.staff_role(v_org), '') <> 'owner' then
    raise exception 'only an owner may close a site' using errcode = 'KIT01';
  end if;
  if v_closed_at is not null then
    raise exception 'that site is already closed' using errcode = 'KIT02';
  end if;
  -- THE ORDER OF THESE THREE IS FORCED BY trial_site_iff_trial. Stage and site move together
  -- in one statement, and that statement runs before the site is stamped closed. Retired
  -- dishes are included: a retired dish still at trial has to come home too.
  update kitchen.dishes set stage = 'development', trial_site_id = null
   where trial_site_id = p_site and stage = 'trial';
  -- Only cooks and site managers are site-scoped. A chef's or an owner's null site_id already
  -- means group-wide, so there is nothing to clear.
  update kitchen.staff set site_id = null
   where site_id = p_site and role in ('cook','site_manager');
  update kitchen.sites set closed_at = now() where id = p_site;
end; $$;

-- Reopening does NOT restore the dishes or the staff assignments that closing moved. Those
-- have been free to change since, and putting them back would overwrite a decision made in
-- the meantime with a guess about what used to be true. It clears `closed_at` and nothing
-- else, so a reopened site starts empty and somebody decides who works there.
create function kitchen.reopen_site(p_site uuid) returns void
language plpgsql security definer set search_path = kitchen, public as $$
declare v_org uuid; v_closed_at timestamptz;
begin
  select org_id, closed_at into v_org, v_closed_at from kitchen.sites where id = p_site;
  if v_org is null then
    raise exception 'no such site' using errcode = 'KIT04';
  end if;
  if coalesce(kitchen.staff_role(v_org), '') <> 'owner' then
    raise exception 'only an owner may reopen a site' using errcode = 'KIT01';
  end if;
  if v_closed_at is null then
    raise exception 'that site is not closed' using errcode = 'KIT02';
  end if;
  update kitchen.sites set closed_at = null where id = p_site;
end; $$;

-- THE BLANKET FORM IS REQUIRED, NOT OPTIONAL. 0039 and 0049 each granted only the functions
-- that existed WHEN THEY RAN, so every function added since kept Postgres's default of
-- EXECUTE to PUBLIC while anon holds USAGE on the schema. That is exactly how the 0049
-- vulnerability became reachable at all. A blanket revoke is the only form that also covers
-- the function nobody has written yet. `peek_invite` is granted back to anon deliberately:
-- an invite link has to say which kitchen it is for before the person signs in.
revoke execute on all functions in schema kitchen from public, anon;
grant execute on all functions in schema kitchen to authenticated, service_role;
grant execute on function kitchen.peek_invite(text) to anon;
