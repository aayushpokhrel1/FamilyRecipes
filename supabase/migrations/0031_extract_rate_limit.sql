-- 0031: a per-user rate limit for recipe extraction.
--
-- extract-recipe calls a paid/free-tier AI model. It validates the caller's JWT and then
-- spends a model call, with no limit at all, so one signed-in account can call it without
-- bound and exhaust the quota for every other cook. 0024 bounded error_log with a global
-- cap, and its own comment admits why: an anonymous caller has no identity to key on. This
-- one is better precisely because auth.uid() exists, so the limit is per cook and a flood
-- costs the flooder their own budget rather than everyone's.
--
-- Done as prevention rather than after an incident, which is the whole point: the fix is a
-- few lines and the downside is a drained model quota for the whole project.

-- One row per extraction that was allowed. The function counts by user and time on every
-- call, so the index below is not optional.
create table extract_log (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

-- The count below scans by user and time on every call, so it needs an index to stay cheap.
create index extract_log_user_time_idx on extract_log (user_id, created_at);

alter table extract_log enable row level security;

-- NO POLICIES, and the ABSENCE of a policy is the design, not an oversight. Nothing outside
-- claim_extraction below may read or write this table: a cook must not be able to see how
-- often anyone else extracts, and must not be able to delete their own rows to buy back
-- budget. The security-definer function is the only door. Do not "fix" this by adding a
-- policy.

-- security definer on purpose: the caller has no policy on extract_log, so the count and the
-- insert only work because this function runs as its owner. search_path is pinned so the
-- definer rights cannot be redirected at a table in another schema.
create function claim_extraction() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid;
  v_minute int;
  v_day int;
  v_retry int;
begin
  v_user := auth.uid();
  if v_user is null then
    raise exception 'not signed in' using errcode = 'insufficient_privilege';
  end if;

  select count(*) into v_minute from extract_log
   where user_id = v_user and created_at > now() - interval '1 minute';
  select count(*) into v_day from extract_log
   where user_id = v_user and created_at > now() - interval '1 day';

  -- Retention, folded in here rather than needing pg_cron, which this project does not use.
  -- Guarded so it runs at most once per quiet minute per cook instead of on every call: the
  -- cap bounds a burst, this bounds the table over time.
  if v_minute = 0 then
    delete from extract_log where created_at < now() - interval '2 days';
  end if;

  -- 10 a minute and 60 a day are KNOBS, not settled numbers: far above any honest rate
  -- (adding one recipe costs one to three extractions), far below anything that drains a
  -- model quota. Raise them if a real cook is ever refused, lower them if the quota still
  -- runs dry.
  --
  -- KNOWN WEAKNESS, stated out loud: the count and the insert are two statements, so a burst
  -- fired in the same millisecond can slip a few past the cap. That is a bounded overshoot,
  -- not an unbounded one, and it self-heals as the window slides. The fix, if it ever
  -- matters, is an advisory lock on the user id.
  if v_minute >= 10 then
    -- Whole seconds until the oldest row in the window leaves it, at least 1 so a caller is
    -- never told to retry in zero seconds.
    select greatest(1, ceil(extract(epoch from
             (created_at + interval '1 minute') - now())))
      into v_retry
      from extract_log
     where user_id = v_user and created_at > now() - interval '1 minute'
     order by created_at
     limit 1;
    return jsonb_build_object('allowed', false, 'scope', 'minute',
                              'retry_after_seconds', v_retry);
  end if;

  if v_day >= 60 then
    select greatest(1, ceil(extract(epoch from
             (created_at + interval '1 day') - now())))
      into v_retry
      from extract_log
     where user_id = v_user and created_at > now() - interval '1 day'
     order by created_at
     limit 1;
    return jsonb_build_object('allowed', false, 'scope', 'day',
                              'retry_after_seconds', v_retry);
  end if;

  insert into extract_log (user_id) values (v_user);
  return jsonb_build_object('allowed', true);
end; $$;

-- PUBLIC first, then anon. Postgres grants execute to PUBLIC on every new function, and
-- revoking from anon alone does NOT undo that: anon would still reach it through PUBLIC.
-- The integration test asserts the anon caller gets 42501 specifically, so if this pair of
-- revokes is ever dropped the test goes red rather than quietly passing.
revoke execute on function claim_extraction() from public;
revoke execute on function claim_extraction() from anon;
grant execute on function claim_extraction() to authenticated;
