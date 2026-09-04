-- 0013 — how the car's money actually moves, corrected by the family.
--
-- Two decisions taken on 4 September 2026, both of which change arithmetic
-- that was already written, and one of which retires D10.
--
-- D13 — A LOSING DAY IS NOT SHARED. It is Abdo's to settle.
--   D10 said a loss splits in the same ratios as a profit, and it does not.
--   Joe pays the day's costs out of the day's takings; when a fine or a
--   repair costs more than the car earned, he is out of pocket and the FAMILY
--   makes him whole. He still records the day — the cost is a fact about that
--   day and hiding it would make the car look cheaper than it is — but no
--   split is posted and no journal is written. The day waits for Abdo, who
--   records the shortfall as an ordinary family expense with a note saying
--   what it was, and hands Joe the cash.
--
--   So `marwa_egp` and `family_egp` can no longer be negative, which quietly
--   removes the rounding hazard the whole system was carrying: PG rounds half
--   away from zero and JS rounds half up, and they only ever disagreed on
--   negative halves.
--
-- D14 — MARWA'S QUARTER COMES THROUGH ABDO, AND IS PAID WITH HER ALLOWANCE.
--   Joe pays the costs, takes his third, and hands the REST to Abdo — the
--   family's share and Marwa's together. So Marwa's quarter is not family
--   income: it is money the family holds on her behalf, a liability, cleared
--   once a month when Abdo pays her allowance. One payment, as she gets now.
--
-- A day therefore posts three lines instead of two:
--
--     due_from_driver     + family + marwa      what Joe is holding for us
--     car_income          − family              what the family earned
--     car_share_payable   − marwa               what we owe Marwa
--
-- and `confirm_handover` clears the receivable for both, because both arrive
-- in the same envelope.

-- --------------------------------------------------- who takes the quarter
-- Named on the family rather than hardcoded: "Marwa" is this family's
-- arrangement, not a property of car ownership, and `marwa_egp` is already
-- one hardcoded name too many.
alter table families add column if not exists car_share_person uuid references people;

comment on column families.car_share_person is
  'Whoever takes the quarter of the car''s net that is not the family''s and '
  'not the driver''s. Marwa, here. The column exists so the arrangement can '
  'change without a migration.';

-- The liability that quarter becomes between earning it and being paid it.
insert into accounts (family_id, kind, name, system_key)
select f.id, 'liability', 'Car share owed', 'car_share_payable'
  from families f
 where not exists (
   select 1 from accounts a
    where a.family_id = f.id and a.system_key = 'car_share_payable');

update families f
   set car_share_person = p.id
  from people p
 where p.family_id = f.id
   and p.display_name = 'Marwa'
   and f.car_share_person is null;

-- ------------------------------------------------------- a loss is not split
alter table car_days add column if not exists loss_journal_id uuid references journals;

comment on column car_days.loss_journal_id is
  'D13. Set when Abdo settles a losing day out of family money. Until it is '
  'set the day is waiting for him, and it is deliberately NOT a status: the '
  'day is still an ordinary recorded day, it simply owes nobody anything.';

-- A losing day has no split at all, so the three shares sum to zero rather
-- than to the net. Days that made money are unchanged.
alter table car_days drop constraint if exists cd_split_is_exact;
alter table car_days add constraint cd_split_is_exact
  check (driver_egp + family_egp + marwa_egp = greatest(net_egp, 0));

-- And with losses out of the split, nobody's share can be negative.
alter table car_days drop constraint if exists cd_shares_not_negative;
alter table car_days add constraint cd_shares_not_negative
  check (driver_egp >= 0 and family_egp >= 0 and marwa_egp >= 0);

-- ------------------------------------------------------------ recording it
create or replace function record_car_day(
  p_family      uuid,
  p_drive_date  date,
  p_worked      boolean,
  p_gross       bigint  default 0,
  p_expenses    jsonb   default '[]',
  p_client_uuid uuid    default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_me       people;
  v_day      uuid;
  v_direct   bigint := 0;
  v_indirect bigint := 0;
  v_net      bigint;
  v_driver   bigint := 0;
  v_family   bigint := 0;
  v_marwa    bigint := 0;
  v_split    record;
  v_line     jsonb;
  v_due      uuid;
  v_income   uuid;
  v_payable  uuid;
  v_sharer   uuid;
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

  -- D2: both classes come off before anyone's share.
  v_net := p_gross - v_direct - v_indirect;

  -- D13: a day that lost money is not shared. It is recorded in full and
  -- left for Abdo; the three shares stay at zero and nothing posts.
  if v_net > 0 then
    select * into v_split from car_split(v_net);
    v_driver := v_split.driver_egp;
    v_family := v_split.family_egp;
    v_marwa  := v_split.marwa_egp;
  end if;

  insert into car_days (family_id, drive_date, worked, gross_egp, direct_egp,
                        indirect_egp, net_egp, driver_egp, family_egp, marwa_egp,
                        status, submitted_by, client_uuid)
       values (p_family, p_drive_date, true, p_gross, v_direct, v_indirect,
               v_net, v_driver, v_family, v_marwa,
               'recorded', v_me.id, p_client_uuid)
    returning id into v_day;

  for v_line in select * from jsonb_array_elements(p_expenses) loop
    insert into car_expenses (car_day_id, label, class, amount_egp, description)
    values (v_day, v_line->>'label', v_line->>'class',
            (v_line->>'amount_egp')::bigint, nullif(v_line->>'description',''));
  end loop;

  if v_family + v_marwa > 0 then
    select id into v_due     from accounts where family_id = p_family and system_key = 'due_from_driver';
    select id into v_income  from accounts where family_id = p_family and system_key = 'car_income';
    select id into v_payable from accounts where family_id = p_family and system_key = 'car_share_payable';
    select car_share_person into v_sharer from families where id = p_family;
    if v_due is null or v_income is null or v_payable is null then
      raise exception 'this family is missing a car account — run the bootstrap';
    end if;

    -- D14: Joe hands Abdo the family's share AND Marwa's, so the receivable
    -- covers both. Only the family's part is income; Marwa's is owed to her.
    v_journal := post_journal_as(
      p_family, v_me.id, p_drive_date,
      'car ' || to_char(p_drive_date, 'DD Mon'),
      jsonb_build_array(
        jsonb_build_object('account_id', v_due,     'amount',  v_family + v_marwa,
                           'person_id', v_me.id),
        jsonb_build_object('account_id', v_income,  'amount', -v_family),
        jsonb_build_object('account_id', v_payable, 'amount', -v_marwa,
                           'person_id', v_sharer)
      ),
      'car_days', v_day, null
    );
    update car_days set journal_id = v_journal where id = v_day;
  end if;

  return v_day;
end $$;

-- --------------------------------------------------------- settling a loss
-- D13. Abdo names the category and says what it was — "car maintenance",
-- "traffic fine" — because a shortfall with no explanation is exactly the
-- kind of entry that starts an argument six months later. The money goes to
-- Joe, who has already paid it.
create or replace function settle_car_loss(
  p_day         uuid,
  p_category    uuid,
  p_memo        text default null,
  p_client_uuid uuid default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_row     car_days;
  v_me      people;
  v_cat     categories;
  v_cash    uuid;
  v_amount  bigint;
  v_journal uuid;
begin
  select * into v_row from car_days where id = p_day;
  if v_row.id is null then raise exception 'no such day'; end if;

  v_me := my_person(v_row.family_id);
  if v_me.id is null or v_me.role is distinct from 'admin' then
    raise exception 'only the family admin settles a losing day'
      using errcode = 'insufficient_privilege';
  end if;

  if v_row.voided_at is not null then raise exception 'that day was voided'; end if;
  if v_row.net_egp >= 0 then raise exception 'that day did not lose money'; end if;
  if v_row.loss_journal_id is not null then
    raise exception 'that day has already been settled';
  end if;

  -- What Joe paid out of his own pocket.
  v_amount := -v_row.net_egp;

  select * into v_cat from categories
   where id = p_category and family_id = v_row.family_id and active and kind = 'expense';
  if v_cat.id is null then
    raise exception 'that is not an expense category in this family';
  end if;

  select id into v_cash from accounts
   where family_id = v_row.family_id and system_key = 'cash';
  if v_cash is null then
    raise exception 'this family has no cash account — run the bootstrap';
  end if;

  v_journal := post_journal_as(
    v_row.family_id, v_me.id, v_row.drive_date,
    coalesce(p_memo, 'car shortfall ' || to_char(v_row.drive_date, 'DD Mon')),
    jsonb_build_array(
      jsonb_build_object('account_id', v_cat.account_id, 'amount', v_amount,
                         'category_id', v_cat.id, 'person_id', v_row.submitted_by),
      jsonb_build_object('account_id', v_cash, 'amount', -v_amount)
    ),
    'car_days', p_day, p_client_uuid
  );

  update car_days set loss_journal_id = v_journal where id = p_day;
  return v_journal;
end $$;

-- ------------------------------------------------------------- the handover
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

  -- D14: what Joe hands over is the family's share AND Marwa's.
  select coalesce(sum(family_egp + marwa_egp), 0), count(*)
    into v_amount, v_count
    from car_days
   where family_id = p_family
     and id = any (p_day_ids)
     and status = 'recorded'
     and voided_at is null
     and family_egp + marwa_egp > 0;      -- a losing day owes nothing

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
     and status = 'recorded' and voided_at is null
     and family_egp + marwa_egp > 0;

  return v_handover;
end $$;

-- -------------------------------------------- her allowance and her quarter
-- D14: one payment a month, as she gets now. The allowance row still records
-- the ALLOWANCE — folding the car share into that figure would make every
-- report of "what we pay Marwa monthly" wrong — but both movements are in the
-- one journal, because in the real world it is one envelope.
create or replace function pay_allowance(
  p_family      uuid,
  p_recipient   uuid,
  p_period      date,
  p_paid_on     date default current_date,
  p_amount      bigint default null,
  p_client_uuid uuid default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_me        people;
  v_cat       categories;
  v_cash      uuid;
  v_payable   uuid;
  v_sharer    uuid;
  v_owed      bigint := 0;
  v_amount    bigint;
  v_lines     jsonb;
  v_journal   uuid;
  v_allowance uuid;
begin
  v_me := my_person(p_family);
  if v_me.id is null or v_me.role is distinct from 'admin' then
    raise exception 'only the family admin pays an allowance'
      using errcode = 'insufficient_privilege';
  end if;

  if p_client_uuid is not null then
    select id into v_allowance from allowances where client_uuid = p_client_uuid;
    if v_allowance is not null then return v_allowance; end if;
  end if;

  if p_period <> date_trunc('month', p_period)::date then
    raise exception 'a period is the first of its month, got %', p_period;
  end if;
  if p_paid_on > current_date then
    raise exception 'that day has not happened yet';
  end if;
  if not exists (select 1 from people
                  where id = p_recipient and family_id = p_family and active) then
    raise exception 'that person is not in this family'
      using errcode = 'insufficient_privilege';
  end if;

  -- 0011: the rate in force at the END of the period.
  v_amount := coalesce(
    p_amount,
    allowance_rate_on(p_recipient, (p_period + interval '1 month - 1 day')::date));
  if v_amount is null then
    raise exception 'no allowance rate has been set for that person';
  end if;
  if v_amount <= 0 then
    raise exception 'there is nothing to pay for that month';
  end if;

  if exists (select 1 from allowances
              where recipient_id = p_recipient and period = p_period) then
    raise exception 'that month has already been paid';
  end if;

  select * into v_cat from categories
   where family_id = p_family and purpose = 'allowance' and active;
  if v_cat.id is null then
    raise exception 'this family has no Allowance category — run the bootstrap';
  end if;

  select id into v_cash from accounts
   where family_id = p_family and system_key = 'cash';
  if v_cash is null then
    raise exception 'this family has no cash account — run the bootstrap';
  end if;

  v_lines := jsonb_build_array(
    jsonb_build_object('account_id', v_cat.account_id, 'amount', v_amount,
                       'category_id', v_cat.id, 'person_id', p_recipient));

  -- If this is the person who takes the car's quarter, her accumulated share
  -- goes out in the same envelope and the liability clears.
  select car_share_person into v_sharer from families where id = p_family;
  if v_sharer = p_recipient then
    select a.id, -coalesce(sum(e.amount), 0)
      into v_payable, v_owed
      from accounts a
      left join entries e on e.account_id = a.id
     where a.family_id = p_family and a.system_key = 'car_share_payable'
     group by a.id;

    if v_payable is not null and v_owed > 0 then
      v_lines := v_lines || jsonb_build_array(
        jsonb_build_object('account_id', v_payable, 'amount', v_owed,
                           'person_id', p_recipient));
    else
      v_owed := 0;
    end if;
  end if;

  v_lines := v_lines || jsonb_build_array(
    jsonb_build_object('account_id', v_cash, 'amount', -(v_amount + v_owed)));

  v_journal := post_journal(
    p_family, p_paid_on,
    'allowance ' || to_char(p_period, 'Mon YYYY')
      || case when v_owed > 0 then ' + car share' else '' end,
    v_lines, 'allowances', null, p_client_uuid);

  insert into allowances (family_id, recipient_id, period, amount_egp,
                          paid_on, paid_by, journal_id, client_uuid)
       values (p_family, p_recipient, p_period, v_amount,
               p_paid_on, v_me.id, v_journal, p_client_uuid)
    returning id into v_allowance;

  return v_allowance;
end $$;

comment on function pay_allowance(uuid, uuid, date, date, bigint, uuid) is
  'Pays one month, once, at the rate in force at the END of that month. For '
  'whoever takes the car''s quarter it also clears what has accrued to them '
  'since the last payment — one envelope, two movements, one journal.';
