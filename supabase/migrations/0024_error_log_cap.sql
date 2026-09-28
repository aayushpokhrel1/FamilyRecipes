-- 0024: bound error_log. 0018 left this as a stated ceiling: no rate limit, and `anon` may
-- insert, so the client's own MAX_REPORTS = 20 cap bounds the honest case and not a hostile
-- one. Unauthenticated unbounded inserts grow the table until the project's disk or quota is
-- the limit, at which point writes fail and the table is useless to read.
--
-- Done as prevention rather than after an incident, which is the whole point: the fix is a
-- few lines and the downside is a database full of junk.

-- The count below scans by time on every insert, so it needs an index to stay cheap.
create index if not exists error_log_created_idx on error_log (created_at);

create function error_log_cap() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  recent int;
begin
  select count(*) into recent from error_log where created_at > now() - interval '1 minute';

  -- Retention, folded in here rather than needing pg_cron, which this project does not use.
  -- Guarded so it runs at most once per quiet minute instead of once per row: the cap bounds
  -- a burst, this bounds the table over time.
  if recent = 0 then
    delete from error_log where created_at < now() - interval '90 days';
  end if;

  -- DROP the row rather than raising. A client reporting an error must never be handed a
  -- second error, and monitoring being full is not the caller's problem.
  --
  -- KNOWN WEAKNESS, measured and pinned by a test: the cap is global, because an anonymous
  -- caller has no identity to key on (user_id is null by design). So a flood buys the
  -- flooder up to 60 seconds of silence for everyone else's errors too. That is strictly
  -- better than an unbounded table and it self-heals, but it is real. The fix, if it ever
  -- matters, is per-IP limiting at an edge function, where the IP is actually visible.
  --
  -- 100 a minute is a KNOB, not a settled number: far above any honest rate from this app,
  -- far below anything that grows the table dangerously. Raise it if a real burst is ever
  -- lost, lower it if junk gets through.
  if recent >= 100 then
    return null;
  end if;

  return new;
end; $$;

create trigger error_log_rate_limit before insert on error_log
  for each row execute function error_log_cap();
