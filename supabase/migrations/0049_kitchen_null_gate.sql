-- 0049: the kitchen role gate admitted a caller with no role at all.
--
-- A full security audit on 2026-10-12 found this and rated it the run's only HIGH.
--
-- `kitchen.staff_role(org)` is a bare SELECT, so it returns NULL when the caller has no
-- staff row for that org. Four pipeline functions wrote the gate as:
--
--     if kitchen.staff_role(v_org) not in ('owner','chef') then raise ... end if;
--
-- `NULL not in (...)` is NULL, and plpgsql DOES NOT EXECUTE AN IF BODY WHOSE CONDITION IS
-- NULL. So the raise was skipped and execution fell through into the privileged work, for
-- exactly the caller with no authority at all. The gate refused every wrong role and
-- admitted the absence of a role.
--
-- The scenario that makes it concrete, and the one to remember: while holding the LOWEST
-- role, 'cook', a user was correctly refused. After the owner DELETED their staff row, the
-- same user could create a dish in that org, revise it, send it to trial at the org's own
-- site, and sign it onto the live menu, writing an approval row in their own name.
-- OFFBOARDING AN EMPLOYEE INCREASED THEIR AUTHORITY. For a product whose entire purpose is
-- recording which version of a dish was approved, that corrupts the record the kitchen
-- relies on, with allergen and method changes riding along.
--
-- `coalesce` rather than `is distinct from` here only because the test is against a set;
-- both are correct. `supabase/rls.test.ts` now fails any negated comparison against a
-- nullable role helper, so this shape cannot come back. Note the direction is what matters:
-- `if role = 'owner' then <privileged work>` fails CLOSED when the helper is NULL and is
-- left alone, while a negated test guarding a refusal fails OPEN.
--
-- This is the SECOND instance of this bug class in this codebase. Migration 0047 nearly
-- shipped `hidden_from_feed` returning NULL instead of false into a policy consumed behind
-- `not`, which would have hidden the public feed from every signed-out visitor. Two
-- independent instances in unrelated code is why the guard is a test and not a comment.

create or replace function kitchen.create_dish(p_org uuid, p_title text) returns uuid
language plpgsql security definer set search_path = kitchen, public as $$
declare v_dish uuid;
begin
  if coalesce(kitchen.staff_role(p_org), '') not in ('owner','chef') then
    raise exception 'only an owner or a chef may start a dish' using errcode = 'KIT01';
  end if;
  insert into kitchen.dishes (org_id, title, created_by)
    values (p_org, p_title, auth.uid()) returning id into v_dish;
  return v_dish;
end; $$;

create or replace function kitchen.revise_dish(
  p_dish uuid, p_note text, p_ingredients jsonb, p_steps jsonb) returns uuid
language plpgsql security definer set search_path = kitchen, public as $$
declare v_org uuid; v_n int; v_version uuid;
begin
  select org_id into v_org from kitchen.dishes where id = p_dish;
  if v_org is null then
    raise exception 'no such dish' using errcode = 'KIT04';
  end if;
  if coalesce(kitchen.staff_role(v_org), '') not in ('owner','chef') then
    raise exception 'only an owner or a chef may revise a dish' using errcode = 'KIT01';
  end if;

  select coalesce(max(n), 0) + 1 into v_n from kitchen.dish_versions where dish_id = p_dish;
  insert into kitchen.dish_versions (dish_id, n, note, created_by)
    values (p_dish, v_n, p_note, auth.uid()) returning id into v_version;

  insert into kitchen.dish_ingredients (version_id, position, quantity, unit, item, section)
  select v_version, (e->>'position')::int, e->>'quantity', e->>'unit', e->>'item', e->>'section'
  from jsonb_array_elements(coalesce(p_ingredients, '[]'::jsonb)) e;

  insert into kitchen.dish_steps (version_id, position, text)
  select v_version, (e->>'position')::int, e->>'text'
  from jsonb_array_elements(coalesce(p_steps, '[]'::jsonb)) e;

  return v_version;
end; $$;

create or replace function kitchen.send_to_trial(p_dish uuid, p_site uuid) returns void
language plpgsql security definer set search_path = kitchen, public as $$
declare v_org uuid; v_stage kitchen.dish_stage;
begin
  select org_id, stage into v_org, v_stage from kitchen.dishes where id = p_dish;
  if v_org is null then
    raise exception 'no such dish' using errcode = 'KIT04';
  end if;
  if coalesce(kitchen.staff_role(v_org), '') not in ('owner','chef') then
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

create or replace function kitchen.sign_off(p_version uuid) returns void
language plpgsql security definer set search_path = kitchen, public as $$
declare v_dish uuid; v_org uuid; v_stage kitchen.dish_stage;
begin
  select v.dish_id, d.org_id, d.stage into v_dish, v_org, v_stage
  from kitchen.dish_versions v join kitchen.dishes d on d.id = v.dish_id
  where v.id = p_version;
  if v_dish is null then
    raise exception 'no such version' using errcode = 'KIT04';
  end if;
  if coalesce(kitchen.staff_role(v_org), '') not in ('owner','chef') then
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

-- THE SECOND HALF, AND THE REASON THE FIRST HALF WAS REACHABLE AT ALL.
--
-- 0039 wrote `grant execute on all functions in schema kitchen`, which covers only the
-- functions that existed WHEN IT RAN. Every function added in 0040 through 0046 therefore
-- kept Postgres's default, which is EXECUTE to PUBLIC, while 0040 separately granted anon
-- USAGE on the schema. The audit read pg_proc and found proacl null, meaning default
-- PUBLIC execute, for ALL ELEVEN kitchen definer functions, not merely the four above.
--
-- Most of the other seven fail closed on `is distinct from` or on a null auth.uid(), so
-- they were not exploitable. That is luck, and it is the same luck that ran out above.
--
-- A blanket revoke is the only form that also covers the function nobody has written yet.
-- `peek_invite` is granted back to anon deliberately: an invite link has to say which
-- kitchen it is for before the person signs in.
revoke execute on all functions in schema kitchen from public, anon;
grant execute on all functions in schema kitchen to authenticated, service_role;
grant execute on function kitchen.peek_invite(text) to anon;
