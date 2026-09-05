-- 0015 — whose midnight counts.
--
-- Found at 00:30 Cairo time, by the checks refusing to run: recording today
-- came back "that day has not happened yet". The database is UTC, Egypt is
-- two or three hours ahead of it, and for those hours every night the app's
-- idea of today is a day the server has not reached.
--
-- It would have hit the family the same way, and worse: Joe finishing a late
-- shift at one in the morning and recording the day he just drove would be
-- told it has not happened. So would Abdo, entering the day's shopping after
-- everyone went to bed.
--
-- The family's day starts at midnight in Cairo. Not in UTC, and not on
-- whichever device happens to be open — Ghada is in Saudi and must not be
-- able to record a day the rest of them are not living in yet.
--
-- Two changes, because the check happens in two places:
--
--   the DATABASE now runs on Africa/Cairo, so `current_date` means the
--   family's today in every function and every CHECK constraint at once;
--
--   the FAMILY carries its timezone as data, so the app computes the same
--   boundary rather than trusting the device, and a second family in another
--   country is a row rather than a rewrite.

do $$
begin
  -- Takes effect for new sessions. Pooled connections carry the old setting
  -- until they cycle, which is minutes, not hours.
  execute format('alter database %I set timezone to %L', current_database(), 'Africa/Cairo');
end $$;

-- PostgREST connects as `authenticator` and switches role per request; the
-- role setting is what actually lands on an API session.
do $$
declare r text;
begin
  foreach r in array array['authenticator','anon','authenticated','service_role'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('alter role %I set timezone to %L', r, 'Africa/Cairo');
    end if;
  end loop;
end $$;

alter table families
  add column if not exists timezone text not null default 'Africa/Cairo';

comment on column families.timezone is
  'Where this family''s day starts. The app asks the family, not the device: '
  'Ghada opening the app from Saudi must not be able to record a day the '
  'rest of them have not reached.';

-- The family's today, for functions that should not depend on a session
-- setting being right. `current_date` agrees with this now, and will keep
-- agreeing for a family in Cairo; a family somewhere else needs this.
create or replace function family_today(p_family uuid) returns date
language sql stable set search_path = public as $$
  select (now() at time zone
          coalesce((select timezone from families where id = p_family), 'Africa/Cairo'))::date
$$;

comment on function family_today(uuid) is
  'Today, where the family lives. Every "that day has not happened yet" check '
  'should be against this rather than against the server''s idea of the date.';
