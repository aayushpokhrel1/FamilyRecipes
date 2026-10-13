-- 0054: three things an invite link did not do.
--
-- 0040's gates are all the fail-CLOSED direction (`is distinct from 'owner'`, a null
-- auth.uid() check), so none of them is the 0049 shape. What it has instead is three gaps in
-- what an invite MEANS once it exists:
--
-- 1. AN INVITE NEVER EXPIRED. `used_at` made a code single-use and nothing made it
--    short-lived, so a link sitting in an old email, a forwarded chat or a browser history
--    employed its bearer for ever. Nothing can revoke one either: the table has a select
--    policy and no delete policy, so not even the owner who minted it can take it back. A
--    lifetime is therefore the only control that exists.
-- 2. AN INVITE OUTLIVED ITS SENDER'S AUTHORITY. `create_invite` checks that the caller is an
--    owner at the moment of minting and nothing re-checks it at acceptance, so an owner who
--    was removed from the org still employed whoever held their outstanding links. This is
--    the direction 0049's HIGH came from: offboarding must REDUCE what someone can do, and
--    here it left a pending grant of authority behind, up to and including an 'owner' invite.
-- 3. ACCEPTING AS EXISTING STAFF BURNED THE CODE AND CHANGED NOTHING. `on conflict do
--    nothing` is right to refuse the write (an invite is not how a role is changed), but the
--    row was then marked used and the page said the person had joined. So an invite meant for
--    a new colleague could be silently consumed by anyone already employed, and the promotion
--    an owner thought they were sending never happened. An invite is not a promotion: the
--    error says so rather than the code disappearing quietly.

-- Seven days. Existing rows get seven days from this migration rather than being expired
-- retroactively, because an invite in flight is somebody's first day.
alter table kitchen.staff_invites
  add column expires_at timestamptz not null default now() + interval '7 days';

-- RESTATED IN FULL from 0040 with the expiry condition added. A stranger must not be told
-- the name of a kitchen by an expired link any more than by a used one, so the lifetime
-- belongs in BOTH functions and not only in the one that writes.
create or replace function kitchen.peek_invite(p_code text)
returns table (org_name text, role text, site_name text)
language sql stable security definer set search_path = kitchen, public as $$
  select o.name, i.role, s.name
  from kitchen.staff_invites i
  join kitchen.orgs o on o.id = i.org_id
  left join kitchen.sites s on s.id = i.site_id
  where i.code = p_code and i.used_at is null and i.expires_at > now();
$$;

-- RESTATED IN FULL from 0040 with the three guards added. Everything else is carried over
-- VERBATIM, including the `for update` and the display-name fallback.
create or replace function kitchen.accept_invite(p_code text, p_display_name text) returns uuid
language plpgsql security definer set search_path = kitchen, public as $$
declare v_invite kitchen.staff_invites;
begin
  if auth.uid() is null then
    raise exception 'sign in first' using errcode = 'KIT01';
  end if;
  -- for update so two people opening the same link cannot both take it.
  -- NEW in 0054: and expires_at, so an old link is as dead as a used one. It stays part of
  -- this predicate rather than becoming a separate raise below, so that an expired code and a
  -- used code are the same KIT04 to the caller: the page already says "it may have been used
  -- already, or it may never have been a link to this kitchen", and which of the two it is
  -- tells a stranger something about a kitchen they have no business knowing.
  select * into v_invite from kitchen.staff_invites
    where code = p_code and used_at is null and expires_at > now() for update;
  if v_invite.code is null then
    raise exception 'that invite is not valid any more' using errcode = 'KIT04';
  end if;
  -- NEW in 0054. A positive `exists` test on purpose: the negated form would be NULL for the
  -- caller with no row at all, and plpgsql skips an IF whose condition is NULL, which is
  -- exactly how 0049's gate let an outsider through. Written this way the refusal fires
  -- whenever the sender's ownership cannot be proven.
  if not exists (
    select 1 from kitchen.staff
    where org_id = v_invite.org_id and user_id = v_invite.created_by and role = 'owner'
  ) then
    raise exception 'whoever sent that invite is no longer an owner here'
      using errcode = 'KIT01';
  end if;
  -- NEW in 0054. Before the insert and before the code is marked used, so the invite is
  -- still there for the colleague it was meant for. An invite is not how a role changes:
  -- that would need its own path, with its own rule about who may raise whom.
  if exists (
    select 1 from kitchen.staff where org_id = v_invite.org_id and user_id = auth.uid()
  ) then
    raise exception 'you already work at this kitchen' using errcode = 'KIT02';
  end if;
  insert into kitchen.staff (org_id, user_id, role, site_id, display_name)
    values (v_invite.org_id, auth.uid(), v_invite.role, v_invite.site_id,
            coalesce(nullif(btrim(p_display_name), ''), 'Chef'))
    on conflict (org_id, user_id) do nothing;
  update kitchen.staff_invites set used_at = now(), used_by = auth.uid() where code = p_code;
  return v_invite.org_id;
end; $$;

-- 0049's blanket revoke covers both functions already, since it ran after them and
-- `create or replace` keeps the privileges a function has. Restated anyway: the pair is
-- cheap, and the day one of these is dropped and recreated instead of replaced it goes back
-- to Postgres's default of EXECUTE to PUBLIC while anon holds USAGE on this schema.
revoke execute on function kitchen.accept_invite(text, text) from public, anon;
grant execute on function kitchen.accept_invite(text, text) to authenticated, service_role;
revoke execute on function kitchen.peek_invite(text) from public;
grant execute on function kitchen.peek_invite(text) to anon, authenticated, service_role;
