-- The table now holds two kinds of claim: a durable "we keep rice in this
-- house" and a short-lived "we have chicken". The old name would lie about the
-- second, and a name that lies about its contents is exactly the confusion that
-- cost this project the aisles-versus-sections detour.
alter table pantry_staples rename to pantry_items;

alter policy staples_read on pantry_items rename to pantry_items_read;
alter policy staples_write on pantry_items rename to pantry_items_write;

alter table pantry_items
  add column kind text not null default 'keep',
  add column state text not null default 'have',
  add column expires_on date;

alter table pantry_items
  add constraint pantry_items_kind_check check (kind in ('keep', 'week')),
  add constraint pantry_items_state_check check (state in ('have', 'low', 'out'));

-- Existing rows already mean exactly this, so the defaults are the migration.
--
-- expires_on is null for a keep item and today+7 for a week item. Week items
-- are filtered out by query once past, rather than swept by a job: rows
-- accumulate slowly, cost nothing, and a cron is a moving part this does not
-- need yet.
comment on column pantry_items.kind is 'keep = always in the cupboard; week = in right now, expires';
comment on column pantry_items.state is 'have | low | out; low and out become real grocery lines';
