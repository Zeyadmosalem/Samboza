-- 0017 — her day, not the family's.
--
-- 0015 settled whose midnight counts for the FAMILY's books, and settled it
-- correctly: Cairo, so that Ghada opening the app from Saudi cannot record a
-- day the rest of them have not reached.
--
-- Her personal book is the one place that reasoning inverts. §3.6 is explicit
-- that it is her own money, in her own country, and none of the family's
-- business — her salary, her rent in Riyadh, her groceries there. Saudi keeps
-- UTC+3 all year and Egypt is on UTC+2 for the winter half of it, so for one
-- hour after every Riyadh midnight her book would refuse the groceries she
-- had just carried home, on the grounds that Cairo had not reached the day
-- yet. That is not a rule about her money. It is the family's clock reaching
-- into a book the family cannot even read.
--
-- Two more things while the table is open, both consistency rather than
-- discovery:
--
--   CHECK cannot look at another table, so the day check becomes a trigger —
--   the same reason assert_person_in_family() is one.
--
--   personal_entries is the last table carrying a (family_id, person_id) pair
--   that 0010's guard was never attached to. The policy already makes a
--   mismatch unreachable through the API, since person_id must equal
--   my_person(family_id).id. Defence in depth costs one line here.

alter table people
  add column if not exists timezone text;

comment on column people.timezone is
  'Where THIS person''s day starts, when it is not where the family''s does. '
  'Null means the family''s, which is the right answer for everyone living '
  'in Cairo. It governs their own private book and nothing else: the family '
  'ledger is on the family''s clock however far away somebody is sitting.';

create or replace function person_today(p_person uuid) returns date
language sql stable set search_path = public as $$
  select (now() at time zone coalesce(p.timezone, f.timezone, 'Africa/Cairo'))::date
  from people p
  join families f on f.id = p.family_id
  where p.id = p_person
$$;

comment on function person_today(uuid) is
  'Today, where this person is. For their own book only — family records are '
  'checked against family_today().';

-- --------------------------------------------------------- the day check
-- Replaces `pe_not_future`, which asked current_date and therefore asked
-- Cairo. Same error code as the constraint it replaces, so anything that
-- already recognises 23514 keeps recognising it.
alter table personal_entries drop constraint if exists pe_not_future;

create or replace function assert_personal_day() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  -- person_today returns nothing for a person that does not exist, and
  -- `occurred_on > null` is null, which is not true — so the check would
  -- pass. Fall back to the family's day rather than through the gap.
  v_today date := coalesce(person_today(new.person_id), family_today(new.family_id));
begin
  if new.occurred_on > v_today then
    raise exception 'that day has not started yet where this person is (their today is %)', v_today
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

create or replace trigger personal_not_future before insert or update on personal_entries
  for each row execute function assert_personal_day();

create or replace trigger personal_person_in_family before insert or update on personal_entries
  for each row execute function assert_person_in_family('person_id');
