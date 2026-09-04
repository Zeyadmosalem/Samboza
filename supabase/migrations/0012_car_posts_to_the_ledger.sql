-- 0012 — the car finally reaches the ledger.
--
-- THE HOLE. `confirm_handover` posts cash in and clears `due_from_driver`,
-- and nothing ever put anything INTO due_from_driver. So the first handover
-- drove the receivable negative — the books said the family owed Joe the
-- money he had just handed over — and the dashboard's "With the driver" read
-- zero however many days he recorded.
--
-- WHAT THE FAMILY'S BOOKS SEE. Per §3.4, only the family's share:
--
--     joe_share      = net ÷ 3               paid to Joe, never family money
--     family_income  = remaining × 0.75      THIS is the family's income
--     marwa_share    = remaining × 0.25      paid to Marwa
--
-- So one journal per day, for family_egp alone:
--
--     due_from_driver   + family_egp     Joe is holding our share
--     car_income        − family_egp     and it is income the day it is earned
--
-- and the handover already written turns that receivable into cash. A short
-- handover leaves the difference sitting in due_from_driver, which is D12
-- exactly: the balance IS the carried amount, with no variance column for
-- anybody to maintain by hand.
--
-- A LOSING DAY (D10) needs no special case. family_egp is negative, so the
-- receivable goes down and income is debited, and a bad Tuesday nets off
-- against a good Wednesday on its own.
--
-- Marwa's share is deliberately NOT in the family's books: Joe settles it
-- with her, which is what `confirm_handover` summing family_egp alone has
-- always assumed. If the family would rather her share came through Abdo, it
-- is one more account and one more line — but that is a decision, not a fix.

-- ------------------------------------------------------- day → its journal
alter table car_days add column if not exists journal_id  uuid references journals;
alter table car_days add column if not exists voided_at   timestamptz;
alter table car_days add column if not exists void_reason text;

comment on column car_days.journal_id is
  'The receivable this day posted. Its reversal is how a mistyped day is '
  'corrected — the row is never edited, because the ledger is append-only.';

-- One row per calendar day, EXCEPT that a voided day frees its date again.
-- Without this a typo on Tuesday costs the family Tuesday forever.
alter table car_days drop constraint if exists car_days_family_id_drive_date_key;
create unique index if not exists car_days_one_live_per_day
  on car_days (family_id, drive_date) where voided_at is null;

-- ------------------------------------------------- posting without a role
-- post_journal checks that the CALLER is the family's admin, which is right
-- for everything a person does by hand and wrong for a day Joe records: the
-- driver must not be able to post to the ledger, and the day he submits must.
--
-- So the checking and the posting are separated. This half validates the
-- journal itself — every account, person and category in the family, the
-- lines balancing, the retry returning the first journal — and takes the
-- recorder as an argument. It decides NOTHING about who is allowed to call
-- it, which is why it is revoked from the API roles below: reachable only
-- from a SECURITY DEFINER function that has already made that decision.
create or replace function post_journal_as(
  p_family       uuid,
  p_recorded_by  uuid,
  p_occurred_on  date,
  p_memo         text,
  p_lines        jsonb,
  p_source_table text default null,
  p_source_id    uuid default null,
  p_client_uuid  uuid default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_journal uuid;
  v_line    jsonb;
  v_total   bigint := 0;
begin
  if p_client_uuid is not null then
    select id into v_journal from journals where client_uuid = p_client_uuid;
    if v_journal is not null then return v_journal; end if;
  end if;

  if jsonb_array_length(p_lines) < 2 then
    raise exception 'a journal needs at least two lines';
  end if;

  if not exists (select 1 from people
                  where id = p_recorded_by and family_id = p_family) then
    raise exception 'the recorder must be a person in this family'
      using errcode = 'insufficient_privilege';
  end if;

  -- 0009, unchanged: a definer function bypasses RLS, so these are the only
  -- checks there are.
  if exists (
    select 1 from jsonb_array_elements(p_lines) l
      left join accounts a on a.id = nullif(l->>'account_id','')::uuid
     where a.id is null or a.family_id <> p_family
  ) then
    raise exception 'every line must post to an account in this family'
      using errcode = 'insufficient_privilege';
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_lines) l
      join people p on p.id = nullif(l->>'person_id','')::uuid
     where p.family_id <> p_family
  ) then
    raise exception 'a journal line names a person from another family'
      using errcode = 'insufficient_privilege';
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_lines) l
      join categories c on c.id = nullif(l->>'category_id','')::uuid
     where c.family_id <> p_family
  ) then
    raise exception 'a journal line names a category from another family'
      using errcode = 'insufficient_privilege';
  end if;

  insert into journals (family_id, occurred_on, recorded_by, memo,
                        source_table, source_id, client_uuid)
       values (p_family, p_occurred_on, p_recorded_by, p_memo,
               p_source_table, p_source_id, p_client_uuid)
    returning id into v_journal;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    insert into entries (journal_id, account_id, amount, person_id, category_id)
    values (v_journal,
            (v_line->>'account_id')::uuid,
            (v_line->>'amount')::bigint,
            nullif(v_line->>'person_id','')::uuid,
            nullif(v_line->>'category_id','')::uuid);
    v_total := v_total + (v_line->>'amount')::bigint;
  end loop;

  if v_total <> 0 then
    raise exception 'journal does not balance: lines sum to %', v_total
      using errcode = 'check_violation';
  end if;

  return v_journal;
end $$;

-- Not an API endpoint. It answers "is this journal well formed", never "are
-- you allowed to post it", so nothing holding only a browser key may call it.
revoke all on function post_journal_as(uuid, uuid, date, text, jsonb, text, uuid, uuid)
  from public, anon, authenticated;

-- post_journal is now exactly the authorisation decision it always was.
create or replace function post_journal(
  p_family       uuid,
  p_occurred_on  date,
  p_memo         text,
  p_lines        jsonb,
  p_source_table text default null,
  p_source_id    uuid default null,
  p_client_uuid  uuid default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_me people;
begin
  v_me := my_person(p_family);
  if v_me.id is null then
    raise exception 'not a member of this family' using errcode = 'insufficient_privilege';
  end if;
  if v_me.role is distinct from 'admin' then
    raise exception 'only the family admin posts to the ledger'
      using errcode = 'insufficient_privilege';
  end if;

  return post_journal_as(p_family, v_me.id, p_occurred_on, p_memo, p_lines,
                         p_source_table, p_source_id, p_client_uuid);
end $$;

-- ---------------------------------------------------------- recording a day
-- Joe sends the takings and the costs. Everything else — the net, the three
-- shares, the rounding — is computed HERE, from car_split(), so the app and
-- the ledger cannot drift apart. Postgres rounds half away from zero and
-- JavaScript rounds half up; they disagree on exact negative halves, which
-- days can now be, so the client must never be the one that decides.
create or replace function record_car_day(
  p_family      uuid,
  p_drive_date  date,
  p_worked      boolean,
  p_gross       bigint  default 0,     -- PIASTRES
  p_expenses    jsonb   default '[]',  -- [{label, class, amount_egp, description?}]
  p_client_uuid uuid    default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_me       people;
  v_day      uuid;
  v_direct   bigint := 0;
  v_indirect bigint := 0;
  v_net      bigint;
  v_split    record;
  v_line     jsonb;
  v_due      uuid;
  v_income   uuid;
  v_journal  uuid;
begin
  v_me := my_person(p_family);
  if v_me.id is null or v_me.role is distinct from 'driver' then
    raise exception 'only the driver records a day'
      using errcode = 'insufficient_privilege';
  end if;

  if p_client_uuid is not null then
    select id into v_day from car_days where client_uuid = p_client_uuid;
    if v_day is not null then return v_day; end if;
  end if;

  if p_drive_date > current_date then
    raise exception 'that day has not happened yet';
  end if;
  if p_gross is null or p_gross < 0 then
    raise exception 'takings cannot be negative';
  end if;

  if not p_worked then
    -- A day off is a RECORDED row, not a missing one: "Joe rested" and "Joe
    -- has not sent it in yet" must never look the same.
    if p_gross <> 0 or jsonb_array_length(p_expenses) > 0 then
      raise exception 'a day off has no takings and no costs';
    end if;
    insert into car_days (family_id, drive_date, worked, status, submitted_by, client_uuid)
         values (p_family, p_drive_date, false, 'off', v_me.id, p_client_uuid)
      returning id into v_day;
    return v_day;
  end if;

  for v_line in select * from jsonb_array_elements(p_expenses) loop
    if (v_line->>'class') not in ('direct','indirect') then
      raise exception 'a cost is direct or indirect, got %', v_line->>'class';
    end if;
    if (v_line->>'amount_egp')::bigint <= 0 then
      raise exception 'a cost must be a positive number of piastres';
    end if;
    if (v_line->>'class') = 'direct'
      then v_direct   := v_direct   + (v_line->>'amount_egp')::bigint;
      else v_indirect := v_indirect + (v_line->>'amount_egp')::bigint;
    end if;
  end loop;

  -- D2: both classes come off BEFORE anyone's share. D10: this may be < 0.
  v_net := p_gross - v_direct - v_indirect;
  select * into v_split from car_split(v_net);

  insert into car_days (family_id, drive_date, worked, gross_egp, direct_egp,
                        indirect_egp, net_egp, driver_egp, family_egp, marwa_egp,
                        status, submitted_by, client_uuid)
       values (p_family, p_drive_date, true, p_gross, v_direct, v_indirect,
               v_net, v_split.driver_egp, v_split.family_egp, v_split.marwa_egp,
               'recorded', v_me.id, p_client_uuid)
    returning id into v_day;

  for v_line in select * from jsonb_array_elements(p_expenses) loop
    insert into car_expenses (car_day_id, label, class, amount_egp, description)
    values (v_day, v_line->>'label', v_line->>'class',
            (v_line->>'amount_egp')::bigint, nullif(v_line->>'description',''));
  end loop;

  -- THE FIX. The family's share is earned today and held by Joe until he
  -- hands it over. A day that nets exactly nothing posts nothing, because a
  -- journal of two zero lines is not a fact about anything.
  if v_split.family_egp <> 0 then
    select id into v_due    from accounts where family_id = p_family and system_key = 'due_from_driver';
    select id into v_income from accounts where family_id = p_family and system_key = 'car_income';
    if v_due is null or v_income is null then
      raise exception 'this family has no due_from_driver or car_income account — run the bootstrap';
    end if;

    v_journal := post_journal_as(
      p_family, v_me.id, p_drive_date,
      'car ' || to_char(p_drive_date, 'DD Mon'),
      jsonb_build_array(
        jsonb_build_object('account_id', v_due,    'amount',  v_split.family_egp,
                           'person_id', v_me.id),
        jsonb_build_object('account_id', v_income, 'amount', -v_split.family_egp)
      ),
      'car_days', v_day, null
    );
    update car_days set journal_id = v_journal where id = v_day;
  end if;

  return v_day;
end $$;

-- ------------------------------------------------------------ undoing one
-- Joe will mistype a day. The row is never edited and the journal is never
-- deleted: the day is marked void and its journal is REVERSED, so the
-- correction is visible rather than silent, and the date is freed to be
-- recorded again.
create or replace function void_car_day(p_day uuid, p_reason text)
returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_row car_days;
  v_me  people;
begin
  select * into v_row from car_days where id = p_day;
  if v_row.id is null then return false; end if;

  v_me := my_person(v_row.family_id);
  if v_me.id is null or v_me.role is distinct from 'admin' then
    raise exception 'only the family admin voids a day'
      using errcode = 'insufficient_privilege';
  end if;
  if v_row.voided_at is not null then return false; end if;
  if v_row.status = 'settled' then
    raise exception 'that day has already been handed over — reverse the handover first';
  end if;

  if v_row.journal_id is not null then
    perform post_journal_as(
      v_row.family_id, v_me.id, current_date,
      coalesce(p_reason, 'voided car day'),
      (select jsonb_agg(jsonb_build_object(
                'account_id', e.account_id, 'amount', -e.amount,
                'person_id',  e.person_id,  'category_id', e.category_id))
         from entries e where e.journal_id = v_row.journal_id),
      'car_days', p_day, null);
  end if;

  update car_days
     set voided_at = now(), void_reason = p_reason
   where id = p_day;

  return true;
end $$;

-- ------------------------------------------------- handovers skip the void
-- Otherwise a voided day is still counted as owed, and the handover asks for
-- money that was cancelled.
create or replace function confirm_handover(
  p_family      uuid,
  p_day_ids     uuid[],
  p_received_on date,
  p_counted_egp bigint,
  p_note        text default null,
  p_client_uuid uuid default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_me       people;
  v_amount   bigint;
  v_journal  uuid;
  v_handover uuid;
  v_count    int;
  v_cash     uuid;
  v_due      uuid;
begin
  v_me := my_person(p_family);
  if v_me.id is null or v_me.role is distinct from 'admin' then
    raise exception 'only the family admin confirms a handover'
      using errcode = 'insufficient_privilege';
  end if;

  if p_counted_egp is null or p_counted_egp <= 0 then
    raise exception 'a handover records what was actually counted, in piastres';
  end if;
  if p_received_on > current_date then
    raise exception 'that day has not happened yet';
  end if;

  if p_client_uuid is not null then
    select id into v_handover from car_handovers where client_uuid = p_client_uuid;
    if v_handover is not null then return v_handover; end if;
  end if;

  select coalesce(sum(family_egp), 0), count(*)
    into v_amount, v_count
    from car_days
   where family_id = p_family
     and id = any (p_day_ids)
     and status = 'recorded'
     and voided_at is null;          -- the guard, and now also the void

  if v_count = 0 then
    raise exception 'no unsettled days in that selection';
  end if;

  select id into v_cash from accounts where family_id = p_family and system_key = 'cash';
  select id into v_due  from accounts where family_id = p_family and system_key = 'due_from_driver';
  if v_cash is null or v_due is null then
    raise exception 'this family has no cash or due_from_driver account — run the bootstrap';
  end if;

  v_journal := post_journal(
    p_family, p_received_on, coalesce(p_note, 'car handover'),
    jsonb_build_array(
      jsonb_build_object('account_id', v_cash, 'amount',  p_counted_egp),
      jsonb_build_object('account_id', v_due,  'amount', -p_counted_egp)
    ),
    'car_handovers', null, p_client_uuid
  );

  insert into car_handovers (family_id, received_on, amount_egp, counted_egp,
                             confirmed_by, journal_id, note, client_uuid)
       values (p_family, p_received_on, v_amount, p_counted_egp,
               v_me.id, v_journal, p_note, p_client_uuid)
    returning id into v_handover;

  update car_days
     set status = 'settled', handover_id = v_handover
   where family_id = p_family and id = any (p_day_ids)
     and status = 'recorded' and voided_at is null;

  return v_handover;
end $$;

-- ------------------------------------------------------------- the door in
-- A day used to be inserted directly, which let the client decide the net and
-- the three shares — and let car_days.direct_egp disagree with the costs
-- actually itemised beside it, because `cd_net_is_derived` only ever compared
-- the day's own columns. record_car_day() computes both from the same lines.
drop policy if exists car_days_insert on car_days;
create policy car_days_no_direct_insert on car_days for insert with check (false);

drop policy if exists car_expenses_insert on car_expenses;
create policy car_expenses_no_direct_insert on car_expenses for insert with check (false);

comment on table car_days is
  'One row per day Joe drives, and per day he rests. Written only by '
  'record_car_day(), which computes the net and the split so the app cannot '
  'disagree with the ledger about either.';
