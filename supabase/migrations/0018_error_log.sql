-- Somewhere for a failure to land. Until now a production error was invisible until a person
-- hit it and said so: the edge function was dead for ~90 minutes on 2026-09-27 and nothing
-- anywhere recorded it.
create table error_log (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  -- Null for a failure nobody was signed in for, which is the whole point of letting anon
  -- insert: a sign-in that fails is exactly the kind of thing worth seeing.
  user_id uuid default auth.uid(),
  context text not null,
  message text not null,
  stack text,
  -- Pathname only, never the full href. On /recipes/:id an href IS a recipe id.
  url text,
  -- Browser quirks have already cost this project real time (EXIF orientation on upload).
  user_agent text
);

alter table error_log enable row level security;

-- INSERT ONLY, and the ABSENCE of a select policy is the design, not an oversight.
-- Nothing can read this table back through the app; Aayush reads it in the SQL editor.
-- That deletes the errors-screen feature entirely, and it avoids deciding which family member
-- may read everyone else's failures, when a message can carry another household's recipe
-- titles. Do not "fix" this by adding a read policy.
--
-- `anon` is included on purpose (see user_id above). The check ties a row to its caller, so
-- nobody can attribute an error to somebody else.
--
-- ponytail: no rate limit, and an anonymous caller can therefore write junk. The client caps
-- itself per page load, which bounds the honest case but not a hostile one. If this is ever
-- flooded, add a limit in a trigger or move inserts behind an edge function.
create policy error_log_insert on error_log for insert to anon, authenticated
  with check (user_id is not distinct from auth.uid());
