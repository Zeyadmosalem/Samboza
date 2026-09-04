-- 0011 — which rate a month is paid at.
--
-- 0010 asked for the rate in force on the FIRST of the month. That is wrong
-- in a way that only shows up on real data: the family's rates were set on
-- the 4th of September, so September had no rate at all and paying it failed
-- with "no allowance rate has been set for that person" — for six people who
-- visibly had one on screen.
--
-- The rule is now the rate in force at the END of the period, and it is the
-- rule that matches what the family means:
--
--   set on the 4th        →  covers that whole month           (was: refused)
--   raised from 1 October →  September keeps September's rate  (unchanged)
--   March paid in June    →  still pays March's rate           (unchanged)
--
-- Only the first line changes behaviour. Effective dating is untouched: a
-- change still never rewrites a month that has already been paid, because a
-- month can only be paid once.
--
-- Forward-only, rather than editing 0010: CI applies migrations from scratch
-- and would pass on the edited file while the live database kept the old
-- function.

create or replace function pay_allowance(
  p_family      uuid,
  p_recipient   uuid,
  p_period      date,                   -- the 1st of the month being paid
  p_paid_on     date default current_date,
  p_amount      bigint default null,    -- null = whatever the rate says
  p_client_uuid uuid default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_me        people;
  v_cat       categories;
  v_cash      uuid;
  v_amount    bigint;
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

  -- THE CHANGE: the last day of the period, not the first. A rate set part
  -- way through a month still covers that month; a rate starting next month
  -- still does not.
  v_amount := coalesce(
    p_amount,
    allowance_rate_on(p_recipient, (p_period + interval '1 month - 1 day')::date)
  );
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

  v_journal := post_journal(
    p_family, p_paid_on,
    'allowance ' || to_char(p_period, 'Mon YYYY'),
    jsonb_build_array(
      jsonb_build_object('account_id', v_cat.account_id, 'amount', v_amount,
                         'category_id', v_cat.id, 'person_id', p_recipient),
      jsonb_build_object('account_id', v_cash, 'amount', -v_amount)
    ),
    'allowances', null, p_client_uuid
  );

  insert into allowances (family_id, recipient_id, period, amount_egp,
                          paid_on, paid_by, journal_id, client_uuid)
       values (p_family, p_recipient, p_period, v_amount,
               p_paid_on, v_me.id, v_journal, p_client_uuid)
    returning id into v_allowance;

  return v_allowance;
end $$;

comment on function pay_allowance(uuid, uuid, date, date, bigint, uuid) is
  'Pays one month, once. The amount is the rate in force at the END of that '
  'month, so a rate set mid-month covers it and a raise dated later does not.';
