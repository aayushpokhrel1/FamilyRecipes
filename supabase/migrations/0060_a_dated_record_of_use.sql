-- 0060: a dated record of use, so "is anyone coming back" has an answer.
--
-- Designed in docs/superpowers/specs/2026-10-16-first-party-events-design.md. Four questions
-- a moderator can act on; three of them need data nobody was keeping. The funnel needs none
-- of this: signed up, joined a family and saved a first recipe are all `created_at` columns
-- that already exist, and they are counted in the `admin` function without a migration.
--
-- WHY A ROW PER DAY RATHER THAN A `last_seen_at` COLUMN. An overwritten timestamp answers
-- "who is here now" and can never answer "of the people who signed up in September, how many
-- still open it", because it keeps no history. That second question is the one worth having.
--
-- WHY A ROW PER SURFACE RATHER THAN AN ARRAY ON ONE DAILY ROW. Appending to an array is a
-- read-modify-write, so two tabs racing lose one of the two surfaces. A row per surface is a
-- single idempotent upsert that needs no read and cannot race. The cost is roughly a dozen
-- rows per person per day, bounded by the surface list in src/lib/api/activity.ts.
--
-- NOTHING HERE IS STORED ON THE DEVICE, which is why this needs no consent banner: the row
-- sits in the database against an account that already exists, on the same footing as a
-- recipe. src/lib/browserStorage.test.ts going red is the signal that something changed that,
-- and softening that test to accommodate anything in this feature would remove the only
-- mechanism that forces /cookies and /privacy back into agreement with the code.

create table activity_days (
  -- ON DELETE CASCADE IS LOAD-BEARING TWICE OVER. It is what makes BOTH account-deletion
  -- paths erase these rows with no code in either, so deletion_parity.test.ts has nothing
  -- new to compare; and without an `on delete` action Postgres defaults to NO ACTION, which
  -- makes this column a veto on account deletion. Eight columns in the `kitchen` schema did
  -- exactly that, and because delete-account blanks the profile FIRST and removes the login
  -- LAST, the refusal landed with the identity already erased and the login still live.
  -- rls.test.ts fails a new reference to auth.users that omits this.
  -- DEFAULTS TO auth.uid(), so the client never sends it, which is exactly what error_log
  -- does and for the same reason: the RLS check below already requires the row to match the
  -- caller, so a client-supplied id could only ever restate what the database knows, or be
  -- refused. One less attacker-controlled field on the write path.
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,

  -- THE CLIENT'S LOCAL DATE, NOT `default current_date`. current_date is UTC, and
  -- lastThirtyDays() in Moderation.tsx already builds its axis from local date parts for the
  -- documented reason that UTC shifts local midnight in any UTC+ timezone onto the previous
  -- day. A retention curve on UTC days drawn against an axis of local days would disagree
  -- with itself and no reader could tell which half was wrong.
  --
  -- A client-supplied date is client-supplied input. The check below is what stops a cook
  -- writing arbitrary dates into their own rows, which RLS permits because they ARE their
  -- rows, and forging a retention history on the one question this table exists to answer.
  -- A day either side covers every real timezone offset, which spans UTC-12 to UTC+14.
  day date not null check (day between current_date - 1 and current_date + 1),

  -- A coarse feature name, never a route. A route is an implementation detail that gets
  -- renamed; "which features are used" is a product question whose answer should survive a
  -- refactor. The list lives in src/lib/api/activity.ts.
  surface text not null,

  primary key (user_id, day, surface)
);

alter table activity_days enable row level security;

-- ONE POLICY, AND DELIBERATELY NO SELECT POLICY FOR ANYBODY.
--
-- A cook may write their own row and read nothing, not even their own. The moderator reads
-- this table through the `admin` edge function, which holds the service role and bypasses RLS
-- by design, and which is already the single place the moderator check lives. A select policy
-- for moderators here would be a second copy of that check, and a copy can drift out of step
-- with the one that actually enforces anything.
--
-- RLS with no policy for an action is the STRICTEST setting, not a gap: it denies every
-- request. `extract_log` is listed in rls.test.ts as deliberately unpoliced for the same
-- reason. One insert policy is what keeps this table off that exemption list.
--
-- `with check` is the whole policy here because an insert has no `using` side. The repo rule
-- about writing `with check` explicitly on every `for update` and `for all` policy is not
-- dodged by that: there is no update policy and no `for all` policy, so a row, once written,
-- cannot be changed by anyone holding the anon key.
create policy activity_self_insert on activity_days
  for insert with check (user_id = auth.uid());

-- WHICH MARKETING PAGE PRODUCED THIS ACCOUNT, or null for "arrived without a credited link".
--
-- Null is the honest answer for everyone who signed up before this shipped, and the panel
-- must label it that way rather than presenting it as "direct", which would be a claim about
-- how they arrived that this column cannot support.
--
-- Three values, validated in the client against a fixed list before it is ever sent, in the
-- same spirit as safeNext() in src/lib/nextPath.ts: `?from=` is attacker-controlled input
-- arriving in a URL, so an unvalidated version of this column is a free-text field a stranger
-- writes into the database. The check constraint is the second half of that, because a
-- validator in one client is a rule the database does not know.
--
-- NOT ADDED TO handle_new_user(). 0037 documents what happens when signup metadata is read
-- in that trigger: `display_name` is set by the app's own email signup and by nothing else,
-- so every Google cook fell through to the literal 'Cook'. Google's OAuth flow does not let
-- the app set user metadata at all, so a trigger-based answer here would work for email
-- signup and silently never fire for Google, which is the same bug wearing a different hat.
-- The client writes this once, after the session exists.
alter table profiles add column signup_source text
  check (signup_source in ('hub', 'family', 'professional'));

-- CREDITING A MARKETING PAGE IS A DEFINER FUNCTION, not a client update, for two reasons.
--
-- First, the rule that makes the number mean anything cannot live in the client. The three
-- marketing pages link to /signin as well as /signup, so "write it whenever the column is
-- null" would credit an existing cook who merely arrived through a marketing link, and would
-- credit every account that predates this feature, since all of their sources are null. The
-- panel would then report the marketing site as having produced accounts older than itself.
-- The question is "did this page produce an ACCOUNT", so the write is refused unless the
-- account was created minutes ago, and `now()` is the only clock that cannot be moved by the
-- caller.
--
-- Second, it keeps this column out of profiles_self_update's `with check`. A cook may update
-- their own profile, so widening that policy to admit signup_source would be one more column
-- a self-update could set, forever. A definer function bypasses RLS by design, so the policy
-- does not change at all and the only way to set this column is through the rule below.
--
-- No uuid parameter, deliberately. It takes the source and nothing else, and reads the subject
-- from auth.uid(), so there is no id for a caller to substitute. rls.test.ts fails a definer
-- function that takes a uuid without tying it to the caller, and the safest version of that
-- is to take no uuid at all.
create function credit_signup_source(p_source text) returns void
language plpgsql security definer set search_path = public as $$
begin
  -- The allowlist is repeated from the column's check constraint on purpose: this function
  -- is the only writer, so a value it accepts is a value that gets stored, and relying on the
  -- constraint alone would turn a bad argument into an exception rather than a no-op.
  if p_source not in ('hub', 'family', 'professional') then
    return;
  end if;

  update profiles
     set signup_source = p_source
   where id = auth.uid()
     -- Written once and never overwritten, so it records the FIRST arrival. A later visit
     -- through a different page is not a second signup.
     and signup_source is null
     -- Only an account that was just created. Ten minutes covers a Google round trip and an
     -- email confirmation opened straight away; a link opened the next day is a returning
     -- visit, not an account this page produced.
     and created_at > now() - interval '10 minutes';
end; $$;

-- auth.uid() is null for anon, so the update matches nothing and the function is a no-op
-- rather than an error. It still takes no privilege it does not need: execute stays with the
-- authenticated role only, because an anonymous caller has nothing to credit.
revoke execute on function credit_signup_source(text) from public, anon;
