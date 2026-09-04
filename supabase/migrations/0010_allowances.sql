-- 0010 — paying the allowance, and what each member has left.
--
-- D3: a fixed monthly amount per person that can be raised or lowered, and
-- changes are EFFECTIVE-DATED so they never rewrite what was already paid.
-- The rate table already did that; this file adds the act of paying, the
-- balance that follows from it, and one structural guard found on the way.
--
-- A month is paid ONCE, ever — `unique (recipient_id, period)` on allowances
-- says so, and this function checks first only to give a better message than
-- a constraint violation.

-- ------------------------------------------------- which category is which
-- pay_allowance has to find the Allowance category, and it cannot do that by
-- name: the family reads the app in Arabic half the time and a category is
-- renameable. `purpose` is the stable handle. Nullable, because almost no
-- category needs one — Food is just Food.
alter table categories add column if not exists purpose text
  check (purpose is null or purpose in ('allowance'));

create unique index if not exists categories_one_per_purpose
  on categories (family_id, purpose) where purpose is not null;

update categories set purpose = 'allowance'
 where purpose is null and name_en = 'Allowance' and kind = 'expense';

comment on column categories.purpose is
  'A stable handle for the categories the system itself has to find. Names '
  'are for people and change; this does not.';

-- ------------------------------------------- a person must be in the family
-- The same defect 0009 fixed in the SECURITY DEFINER functions exists on the
-- tables written directly: `allowances_write` and `rates_write` check that
-- the caller is the family's admin, and never check that recipient_id is a
-- person in that family. The row's family_id is correct and the name on it
-- belongs to a stranger — which resolves to nothing on screen, because
-- `people` is scoped by family, so the row simply displays blank forever.
--
-- A CHECK constraint cannot look at another table, so this is a trigger. One
-- function, told which column to inspect, rather than five near-copies.
create or replace function assert_person_in_family() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_column text  := tg_argv[0];
  v_person uuid  := (to_jsonb(new) ->> v_column)::uuid;
begin
  if v_person is not null and not exists (
    select 1 from people where id = v_person and family_id = new.family_id
  ) then
    raise exception '%.% must name a person in this family', tg_table_name, v_column
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end $$;

create or replace trigger rates_recipient_in_family before insert or update on allowance_rates
  for each row execute function assert_person_in_family('recipient_id');
create or replace trigger allowances_recipient_in_family before insert or update on allowances
  for each row execute function assert_person_in_family('recipient_id');
create or replace trigger me_person_in_family before insert or update on member_expenses
  for each row execute function assert_person_in_family('person_id');
create or replace trigger car_days_submitter_in_family before insert or update on car_days
  for each row execute function assert_person_in_family('submitted_by');
create or replace trigger remittances_from_in_family before insert or update on remittances
  for each row execute function assert_person_in_family('from_person');

-- ------------------------------------------------------ setting a new rate
-- Effective-dated: this never touches an existing row, it adds the next one.
-- Re-setting the same date replaces that date's figure, which is a
-- correction; every other date's history is untouched either way.
create or replace function set_allowance_rate(
  p_family         uuid,
  p_recipient      uuid,
  p_amount         bigint,        -- PIASTRES per month; 0 ends the allowance
  p_effective_from date default current_date
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_me people;
  v_id uuid;
begin
  v_me := my_person(p_family);
  if v_me.id is null or v_me.role is distinct from 'admin' then
    raise exception 'only the family admin sets an allowance'
      using errcode = 'insufficient_privilege';
  end if;
  if p_amount is null or p_amount < 0 then
    raise exception 'an allowance cannot be negative';
  end if;
  if not exists (select 1 from people
                  where id = p_recipient and family_id = p_family and active) then
    raise exception 'that person is not in this family'
      using errcode = 'insufficient_privilege';
  end if;

  insert into allowance_rates (family_id, recipient_id, amount_egp, effective_from, set_by)
       values (p_family, p_recipient, p_amount, p_effective_from, v_me.id)
  on conflict (recipient_id, effective_from)
    do update set amount_egp = excluded.amount_egp, set_by = excluded.set_by
  returning id into v_id;

  return v_id;
end $$;

-- --------------------------------------------------------------- paying it
-- The disbursement is a real family expense, so it posts to the ledger like
-- any other: the Allowance category takes the charge and cash goes down. It
-- is NOT the member's sub-ledger — that records what they then spend, and
-- adding the two together would count the same money twice.
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

  -- The rate IN FORCE FOR THAT MONTH, not today's. Paying March in June must
  -- pay what March was worth.
  v_amount := coalesce(p_amount, allowance_rate_on(p_recipient, p_period));
  if v_amount is null then
    raise exception 'no allowance rate has been set for that person';
  end if;
  if v_amount <= 0 then
    raise exception 'there is nothing to pay for that month';
  end if;

  -- Checked here for the message; `unique (recipient_id, period)` is what
  -- actually makes it true when two devices press pay at once.
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

-- ------------------------------------------------------ what is left of it
-- Derived, never stored — §3.3: balance = allowance received − spending
-- approved. Pending submissions are carried alongside rather than subtracted,
-- because a member wants to see what is still in the air and Abdo needs to
-- know what he has not decided yet; folding them into one number hides both.
--
-- Built from the union of the three sources rather than from `people`, so a
-- member querying it gets ONE row — their own — instead of a roster of
-- everybody at zero, which would read as "the family spends nothing".
create or replace view member_balances as
  with recipients as (
    select family_id, recipient_id as person_id from allowance_rates
    union
    select family_id, recipient_id from allowances
    union
    select family_id, person_id from member_expenses
  ),
  paid as (
    select family_id, recipient_id as person_id,
           sum(amount_egp) as received,
           max(period)     as last_period
      from allowances group by family_id, recipient_id
  ),
  spent as (
    select family_id, person_id,
           coalesce(sum(amount_egp) filter (where status = 'approved'), 0) as approved,
           coalesce(sum(amount_egp) filter (where status = 'pending'),  0) as pending,
           count(*) filter (where status = 'pending')                      as pending_count
      from member_expenses group by family_id, person_id
  )
  select r.family_id,
         r.person_id,
         coalesce(p.received, 0)                            as received,
         coalesce(s.approved, 0)                            as approved,
         coalesce(p.received, 0) - coalesce(s.approved, 0)  as balance,
         coalesce(s.pending, 0)                             as pending,
         coalesce(s.pending_count, 0)                       as pending_count,
         p.last_period,
         allowance_rate_on(r.person_id, current_date)       as rate
    from recipients r
    left join paid  p on p.family_id = r.family_id and p.person_id = r.person_id
    left join spent s on s.family_id = r.family_id and s.person_id = r.person_id;

-- Without this the view runs as its owner and hands every member the whole
-- family's balances — the exact leak 0008 closed, which is why the RLS suite
-- fails the build if any view in public is left without it.
alter view member_balances set (security_invoker = on);

comment on view member_balances is
  'Allowance received minus spending approved, per person. security_invoker '
  'is ON, so a member sees one row and the admin sees the family.';
