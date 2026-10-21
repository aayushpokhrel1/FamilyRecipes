-- 0064: a dated record of who opens the kitchen app, per group.
--
-- Designed in docs/superpowers/specs/2026-10-21-kitchen-measurement-design.md. This is the ONLY
-- new storage in that feature: whether a dish lands, where a group stalls and which sites are
-- real are all arithmetic over timestamps this schema already keeps (0063). Whether a person
-- comes back is recorded nowhere, so it needs a table.
--
-- THE DIFFERENCE FROM 0060, AND IT IS THE WHOLE RISK IN THIS FILE: the primary key carries
-- org_id. A chef can hold a staff row in two groups, and the owner of one must never see their
-- attendance in the other. The family's activity_days has no group to key by, so this is a real
-- difference rather than the same table in another schema, and an owner reading another
-- employer's attendance is the failure this key exists to make impossible.
--
-- WHAT IS CARRIED OVER FROM 0060, whose header has the long form of each: a row per day per
-- surface rather than a last_seen_at column, because an overwritten timestamp can never answer
-- "of the people who joined in September, how many still open it"; the CLIENT's local date
-- rather than current_date, because current_date is UTC and local midnight in any UTC+ timezone
-- would report the previous day; a coarse surface name rather than a route, because a route is
-- an implementation detail that gets renamed and "which parts are used" is a product question
-- whose answer should survive a refactor; and nothing stored on the device, which is why this
-- needs no consent banner and why src/lib/browserStorage.test.ts going red is the signal that
-- something changed that.
--
-- THIS TABLE IS WHY THE KITCHEN PRIVACY PAGE CHANGES IN THE SAME FEATURE. An owner is shown a
-- row per person, by name, so the app has to say so and the terms version has to move, or the
-- acceptance on record is a lie. src/kitchen/components/KitchenTermsGate.version.test.tsx is
-- the mechanism that enforces it.
create table kitchen.activity_days (
  -- ON DELETE CASCADE, so erasing a group (0062) takes its attendance with it. Without an
  -- action Postgres defaults to NO ACTION, which would make this table a veto on erasure.
  org_id uuid not null references kitchen.orgs(id) on delete cascade,

  -- ON DELETE CASCADE IS LOAD-BEARING TWICE, exactly as 0060 says of its own column. It makes
  -- both account-deletion paths erase these rows with no code in either, so
  -- supabase/deletion_parity.test.ts has nothing new to compare; and without it this column
  -- would be a VETO on account deletion. Eight columns in this schema were written that way,
  -- and because delete-account blanks the profile FIRST and removes the login LAST, the
  -- refusal landed with the identity already erased and the login still live. rls.test.ts
  -- fails a new reference to auth.users that omits this.
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,

  -- The client's local date. A client-supplied date is client-supplied input, and this check is
  -- what stops a staff member writing arbitrary dates into their own rows, which RLS permits
  -- because they ARE their rows. A day either side covers every real timezone offset, which
  -- spans UTC-12 to UTC+14.
  day date not null check (day between current_date - 1 and current_date + 1),

  -- A coarse feature name, never a route. The list lives in src/lib/api/kitchen/visit.ts and is
  -- validated again in the writer below, which is the real boundary.
  surface text not null,

  -- org_id FIRST, and the reason is above: this is the one line standing between an owner and
  -- another employer's attendance.
  primary key (org_id, user_id, day, surface)
);

alter table kitchen.activity_days enable row level security;

-- A NEW KITCHEN TABLE IS GRANTED TO NOBODY. 0039's schema-wide grant covers only the tables
-- that existed when it ran, so without this every call fails with 42501 while the policies look
-- perfect and the negative tests pass for the wrong reason: the caller is refused by the
-- missing grant rather than by the policy. 0046 shipped without it. service_role too, because
-- it bypasses RLS but not grants, and without it the key the edge functions and the integration
-- tests use reads an empty table rather than an error, which is the worst failure of all.
grant select, insert, update, delete on kitchen.activity_days to authenticated, service_role;

-- ONE POLICY, AND DELIBERATELY NO SELECT POLICY FOR ANYBODY.
--
-- A staff member may write their own row and read nothing, not even their own. The owner reads
-- this through kitchen.group_people() (0065), a definer function that holds the role check. A
-- select policy here would be a second copy of that check, and a copy can drift out of step
-- with the one that actually enforces anything.
--
-- RLS with no policy for an action is the STRICTEST setting, not a gap: it denies every request.
-- One insert policy is what keeps this table off rls.test.ts's deliberately-unpoliced list.
--
-- `with check` is the whole policy because an insert has no `using` side. The repo rule about
-- writing `with check` explicitly on every `for update` and `for all` policy is not dodged by
-- that: there is no update policy and no `for all` policy here, so a row, once written, cannot
-- be changed by anyone holding the publishable key.
--
-- This policy is defence in depth rather than the path the app takes, which is the function
-- below, for the reason written there.
create policy activity_self_insert on kitchen.activity_days
  for insert with check (user_id = auth.uid());

-- RECORDING A VISIT GOES THROUGH A FUNCTION, AND A CLIENT UPSERT CANNOT WORK.
--
-- 0060 proved this on the family side and the reason is structural rather than incidental: to
-- decide whether a row conflicts, Postgres has to LOOK at the conflicting row, so `on conflict`
-- needs a select policy on the table. This table deliberately has none, and its unreadability
-- is the half worth keeping, so the upsert moves into a definer function. That is strictly
-- better than the client write it replaces: the client no longer names the person at all, so a
-- row cannot be attributed to anyone else even in principle, rather than being refused when it
-- tries.
--
-- The uuid parameter is the ORG, never the person, and it is tied to the caller by is_staff()
-- below. rls.test.ts fails a definer function that takes a uuid without tying it to auth.uid().
create function kitchen.record_kitchen_visit(p_org uuid, p_day date, p_surface text)
returns void
language plpgsql security definer set search_path = kitchen, public as $$
begin
  -- EVERY REFUSAL BELOW IS A QUIET RETURN, NOT A RAISE. This is called on every navigation
  -- inside a group, so it must never be the thing that breaks one. A measurement that can
  -- raise is a measurement that can take down the app it is measuring.

  -- Anonymous callers have nothing to attribute.
  if auth.uid() is null then
    return;
  end if;

  -- THE GATE, AND IT IS POSITIVE. kitchen.is_staff() is an `exists`, so it returns true or
  -- false and never NULL, which is why it can be read directly here where staff_role() could
  -- not: `if staff_role(p_org) is not null` would be the same thing written in the shape that
  -- has failed open twice in this schema. A non-member writes nothing, so the table cannot be
  -- filled with rows for groups the caller has nothing to do with.
  if not kitchen.is_staff(p_org) then
    return;
  end if;

  -- The surface list is validated HERE as well as in the client, because this function bypasses
  -- RLS and so is the real boundary: without it, p_surface is a free-text column a signed-in
  -- caller writes at will, and the owner's feature-use figures become whatever they typed.
  if p_surface not in ('sites', 'staff', 'dishes', 'numbers', 'settings') then
    return;
  end if;

  -- The same window as the column's check constraint, written out rather than left to the
  -- constraint because a constraint violation would RAISE, and this function must not.
  --
  -- `p_day is null` is tested FIRST and explicitly. Both comparisons below are NULL for a null
  -- argument, so plpgsql would skip the IF body and the insert would raise on the not-null
  -- column. That fails closed, which is the safe direction, but it is still a measurement
  -- raising.
  if p_day is null or p_day < current_date - 1 or p_day > current_date + 1 then
    return;
  end if;

  insert into kitchen.activity_days (org_id, user_id, day, surface)
  values (p_org, auth.uid(), p_day, p_surface)
  on conflict (org_id, user_id, day, surface) do nothing;
end; $$;

-- The three-line trailer every migration in this schema has ended with since 0049. Revoking
-- without the re-grant takes execute away from `authenticated` too, because 0039's
-- `grant execute on all functions` covered only what existed then and everything since reaches
-- these functions through the PUBLIC grant. 0063 learned that from a 42501 in its own tests.
revoke execute on all functions in schema kitchen from public, anon;
grant execute on all functions in schema kitchen to authenticated, service_role;
grant execute on function kitchen.peek_invite(text) to anon;
