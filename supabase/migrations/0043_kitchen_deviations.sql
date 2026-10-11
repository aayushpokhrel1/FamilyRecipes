-- 0043: a site records what it had to change, WITHOUT changing the group version.
--
-- This table is the reason the central spec can stay central. The alternative, letting a
-- site edit the dish, destroys the only thing the product sells: one answer to what the
-- current version is.
create table kitchen.deviations (
  id uuid primary key default gen_random_uuid(),
  dish_id uuid not null references kitchen.dishes(id) on delete cascade,
  site_id uuid not null references kitchen.sites(id) on delete cascade,
  note text not null,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);
alter table kitchen.deviations enable row level security;
create policy deviations_read on kitchen.deviations for select
  using (kitchen.can_read_dish(dish_id));
grant select, insert, update, delete on kitchen.deviations to authenticated, service_role;

create function kitchen.record_deviation(p_dish uuid, p_site uuid, p_note text) returns uuid
language plpgsql security definer set search_path = kitchen, public as $$
declare v_org uuid; v_role text; v_my_site uuid; v_id uuid;
begin
  select org_id into v_org from kitchen.dishes where id = p_dish;
  if v_org is null then
    raise exception 'no such dish' using errcode = 'KIT04';
  end if;
  v_role := kitchen.staff_role(v_org);
  v_my_site := kitchen.staff_site(v_org);
  -- An owner or a chef speaks for the group. A site_manager speaks for THEIR site only, and
  -- a cook does not record anything.
  if v_role in ('owner','chef') then
    null;
  elsif v_role = 'site_manager' and v_my_site is not null and v_my_site = p_site then
    null;
  else
    raise exception 'you cannot record a deviation for that site' using errcode = 'KIT01';
  end if;
  if not exists (select 1 from kitchen.sites where id = p_site and org_id = v_org) then
    raise exception 'that site belongs to another org' using errcode = 'KIT04';
  end if;
  insert into kitchen.deviations (dish_id, site_id, note, created_by)
    values (p_dish, p_site, p_note, auth.uid()) returning id into v_id;
  return v_id;
end; $$;
