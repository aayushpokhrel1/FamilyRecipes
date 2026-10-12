-- Who accepted which version of the KITCHEN terms. A separate record from the family app's
-- profiles.terms_accepted_at, and separate on purpose: the kitchen app may not import
-- lib/api/profile.ts (supabase/kitchen_seal.test.ts), and the two documents are different
-- products that must be revisable without re-prompting each other's users.
--
-- KEYED BY USER, NOT BY ORG. A person accepts once rather than once per employer, and a
-- brand-new account has no kitchen.staff row at all while "create a group" is already an
-- action that has to be gated.
--
-- No SECURITY DEFINER function in front of this: the client upserts its own row under RLS.
-- The version string is a client-side fact either way, exactly as it is on the family side,
-- because it records which text the client rendered.
create table kitchen.terms_acceptance (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  version     text not null,
  accepted_at timestamptz not null default now()
);

alter table kitchen.terms_acceptance enable row level security;

create policy terms_read_own on kitchen.terms_acceptance
  for select using (user_id = auth.uid());
create policy terms_insert_own on kitchen.terms_acceptance
  for insert with check (user_id = auth.uid());
create policy terms_update_own on kitchen.terms_acceptance
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

-- REQUIRED, and 0039 says so at the top of the schema: a new schema is granted to nobody, so
-- the grant that 0039 wrote covers only the tables that existed then. Without this line every
-- call fails with 42501 (insufficient privilege) while the policies above look perfect, and
-- the negative tests PASS FOR THE WRONG REASON, because a stranger is refused by the missing
-- grant rather than by the policy. This file shipped without it for exactly as long as it took
-- rls.test.ts to name the table.
--
-- anon is deliberately absent: accepting terms requires a session, and a row keyed to
-- auth.uid() is meaningless without one.
grant select, insert, update, delete on kitchen.terms_acceptance to authenticated, service_role;