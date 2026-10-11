-- 0040: staff join an org by link.
--
-- Three functions rather than one, because the three things a link must do have three
-- different audiences: peek_invite answers a stranger who is NOT signed in (so the page can
-- say "Invite Group wants you as a site manager at Shoreditch" before they have an account),
-- accept_invite is a separate deliberate act (a forwarded link must not employ anybody), and
-- create_invite is the owner's alone.
--
-- The DESTINATION of the link travels in the URL and goes through safeNext, never in router
-- state. That rule is not optional: the family app lost its invite destination on three of
-- the four ways in, and the fix then lost it again inside an async callback.
create table kitchen.staff_invites (
  code text primary key default encode(extensions.gen_random_bytes(6), 'hex'),
  org_id uuid not null references kitchen.orgs(id) on delete cascade,
  role text not null check (role in ('owner','chef','site_manager','cook')),
  site_id uuid references kitchen.sites(id) on delete set null,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  used_at timestamptz,
  used_by uuid references auth.users(id)
);
alter table kitchen.staff_invites enable row level security;
-- Staff of the org may see its invites. A STRANGER MAY NOT: they go through peek_invite,
-- which returns three harmless columns for one code and nothing else. A select policy wide
-- enough for a stranger would hand out every code in the table.
create policy invites_staff_read on kitchen.staff_invites for select
  using (kitchen.is_staff(org_id));
-- Repeated from 0039 because a new table in this schema is granted to nobody.
grant select, insert, update, delete on kitchen.staff_invites to authenticated, service_role;

create function kitchen.create_invite(p_org uuid, p_role text, p_site uuid) returns text
language plpgsql security definer set search_path = kitchen, public as $$
declare v_code text;
begin
  if kitchen.staff_role(p_org) is distinct from 'owner' then
    raise exception 'only an owner may invite staff' using errcode = 'KIT01';
  end if;
  if p_site is not null and not exists (
    select 1 from kitchen.sites where id = p_site and org_id = p_org) then
    raise exception 'that site belongs to another org' using errcode = 'KIT04';
  end if;
  insert into kitchen.staff_invites (org_id, role, site_id, created_by)
    values (p_org, p_role, p_site, auth.uid()) returning code into v_code;
  return v_code;
end; $$;

-- Readable by anon on purpose, and it is why the table itself is not. It takes one code and
-- returns three names, so it cannot be used to enumerate anything.
create function kitchen.peek_invite(p_code text)
returns table (org_name text, role text, site_name text)
language sql stable security definer set search_path = kitchen, public as $$
  select o.name, i.role, s.name
  from kitchen.staff_invites i
  join kitchen.orgs o on o.id = i.org_id
  left join kitchen.sites s on s.id = i.site_id
  where i.code = p_code and i.used_at is null;
$$;
grant execute on function kitchen.peek_invite(text) to anon, authenticated;
grant usage on schema kitchen to anon;

create function kitchen.accept_invite(p_code text, p_display_name text) returns uuid
language plpgsql security definer set search_path = kitchen, public as $$
declare v_invite kitchen.staff_invites;
begin
  if auth.uid() is null then
    raise exception 'sign in first' using errcode = 'KIT01';
  end if;
  -- for update so two people opening the same link cannot both take it.
  select * into v_invite from kitchen.staff_invites
    where code = p_code and used_at is null for update;
  if v_invite.code is null then
    raise exception 'that invite is not valid any more' using errcode = 'KIT04';
  end if;
  insert into kitchen.staff (org_id, user_id, role, site_id, display_name)
    values (v_invite.org_id, auth.uid(), v_invite.role, v_invite.site_id,
            coalesce(nullif(btrim(p_display_name), ''), 'Chef'))
    on conflict (org_id, user_id) do nothing;
  update kitchen.staff_invites set used_at = now(), used_by = auth.uid() where code = p_code;
  return v_invite.org_id;
end; $$;
