-- Row-level security: the assertions that matter are the DENIALS.
--
-- Run: supabase test db
-- CI runs this on every push. A permissions regression must break the build.
--
-- Zeyad reading Rewan's spending, or Joe reading the family ledger, is a
-- family argument rather than a bug report — so each of those is asserted
-- explicitly rather than assumed to follow from a policy that looks right.

begin;

-- The helpers are created as postgres but CALLED as authenticated, once
-- tests.be() switches role. Without these grants every assertion dies on
-- 'permission denied for schema tests' before it runs.
create schema if not exists tests;
grant usage on schema tests to public;

select plan(58);

-- ------------------------------------------------------------ fixtures
-- Two families, so cross-tenant leakage is testable rather than theoretical.
insert into auth.users (id, email) values
  ('11111111-1111-4111-8111-111111111111', 'abdo@samboza.family'),
  ('22222222-2222-4222-8222-222222222222', 'ghada@samboza.family'),
  ('33333333-3333-4333-8333-333333333333', 'zeyad@samboza.family'),
  ('44444444-4444-4444-8444-444444444444', 'rewan@samboza.family'),
  ('55555555-5555-4555-8555-555555555555', 'joe@samboza.family'),
  ('66666666-6666-4666-8666-666666666666', 'outsider@other.family');

insert into families (id, code, name) values
  ('aaaaaaaa-0000-4000-8000-000000000001', 'SMBZ-7420', 'Samboza'),
  ('aaaaaaaa-0000-4000-8000-000000000002', 'OTHR-1000', 'Other');

insert into people (id, family_id, member_no, display_name, relationship,
                    is_user, auth_user_id, role) values
  ('bbbb0000-0000-4000-8000-000000000001','aaaaaaaa-0000-4000-8000-000000000001',2,'Abdo','brother',        true,'11111111-1111-4111-8111-111111111111','admin'),
  ('bbbb0000-0000-4000-8000-000000000002','aaaaaaaa-0000-4000-8000-000000000001',1,'Ghada','mother',        true,'22222222-2222-4222-8222-222222222222','viewer'),
  ('bbbb0000-0000-4000-8000-000000000003','aaaaaaaa-0000-4000-8000-000000000001',3,'Zeyad','son',           true,'33333333-3333-4333-8333-333333333333','member'),
  ('bbbb0000-0000-4000-8000-000000000004','aaaaaaaa-0000-4000-8000-000000000001',4,'Rewan','daughter',      true,'44444444-4444-4444-8444-444444444444','member'),
  ('bbbb0000-0000-4000-8000-000000000005','aaaaaaaa-0000-4000-8000-000000000001',9,'Joe','uncle_maternal',  true,'55555555-5555-4555-8555-555555555555','driver'),
  ('bbbb0000-0000-4000-8000-000000000006','aaaaaaaa-0000-4000-8000-000000000002',1,'Outsider','external',   true,'66666666-6666-4666-8666-666666666666','admin');

insert into accounts (id, family_id, kind, name, system_key) values
  ('cccc0000-0000-4000-8000-000000000001','aaaaaaaa-0000-4000-8000-000000000001','asset','Cash','cash'),
  ('cccc0000-0000-4000-8000-000000000002','aaaaaaaa-0000-4000-8000-000000000001','income','Car income','car_income'),
  ('cccc0000-0000-4000-8000-000000000003','aaaaaaaa-0000-4000-8000-000000000001','asset','Due from driver','due_from_driver'),
  ('cccc0000-0000-4000-8000-000000000005','aaaaaaaa-0000-4000-8000-000000000001','expense','Allowance','cat:allowance'),
  -- The OTHER family's cash. Nothing in Samboza may ever post to it.
  ('cccc0000-0000-4000-8000-000000000004','aaaaaaaa-0000-4000-8000-000000000002','asset','Their cash','cash');

insert into categories (id, family_id, name_en, name_ar, kind, account_id) values
  ('dddd0000-0000-4000-8000-000000000001','aaaaaaaa-0000-4000-8000-000000000001','Food','الأكل','expense','cccc0000-0000-4000-8000-000000000002');

-- `purpose` is how pay_allowance finds this one. Not the name: the family
-- reads half the app in Arabic, and a category can be renamed.
insert into categories (id, family_id, name_en, name_ar, kind, account_id, purpose) values
  ('dddd0000-0000-4000-8000-000000000002','aaaaaaaa-0000-4000-8000-000000000001',
   'Allowance','المصروف','expense','cccc0000-0000-4000-8000-000000000005','allowance');

insert into journals (id, family_id, occurred_on, recorded_by, memo) values
  ('eeee0000-0000-4000-8000-000000000001','aaaaaaaa-0000-4000-8000-000000000001', current_date,
   'bbbb0000-0000-4000-8000-000000000001','seed');
insert into entries (journal_id, account_id, amount) values
  ('eeee0000-0000-4000-8000-000000000001','cccc0000-0000-4000-8000-000000000001',  10000),
  ('eeee0000-0000-4000-8000-000000000001','cccc0000-0000-4000-8000-000000000002', -10000);

insert into member_expenses (id, family_id, person_id, category_id, amount_egp, occurred_on) values
  ('ffff0000-0000-4000-8000-000000000001','aaaaaaaa-0000-4000-8000-000000000001',
   'bbbb0000-0000-4000-8000-000000000004','dddd0000-0000-4000-8000-000000000001', 5000, current_date);

insert into car_days (id, family_id, drive_date, submitted_by, gross_egp,
                      direct_egp, indirect_egp, net_egp, driver_egp, family_egp, marwa_egp) values
  ('99990000-0000-4000-8000-000000000001','aaaaaaaa-0000-4000-8000-000000000001',
   current_date, 'bbbb0000-0000-4000-8000-000000000005', 90000, 15000, 0, 75000, 25000, 37500, 12500);

insert into personal_entries (family_id, person_id, direction, category, amount, currency, occurred_on)
 values ('aaaaaaaa-0000-4000-8000-000000000001','bbbb0000-0000-4000-8000-000000000002',
         'out','p_rent', 250000, 'SAR', current_date);

-- ------------------------------------------------------------ helper
create or replace function tests.be(p_uid uuid) returns void
language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
                     json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
end $$;

-- NOT security definer: the dynamic query must run as the CURRENT role so
-- that row-level security actually applies to it. That is the whole point.
create or replace function tests.rows_in(p_sql text) returns bigint
language plpgsql as $$
declare n bigint;
begin execute 'select count(*) from (' || p_sql || ') q' into n; return n; end $$;

grant execute on function tests.be(uuid)      to public;
grant execute on function tests.rows_in(text) to public;

-- =====================================================================
-- Zeyad — a member. Sees his own, and nothing else.
-- =====================================================================
select tests.be('33333333-3333-4333-8333-333333333333');

select is(tests.rows_in('select 1 from member_expenses'), 0::bigint,
  'Zeyad cannot read Rewan''s submissions');

select is(tests.rows_in('select 1 from entries'), 0::bigint,
  'Zeyad cannot read the family ledger');

select is(tests.rows_in('select 1 from journals'), 0::bigint,
  'Zeyad cannot read journals');

select is(tests.rows_in('select 1 from accounts'), 0::bigint,
  'Zeyad cannot read accounts');

select is(tests.rows_in('select 1 from ledger_feed'), 0::bigint,
  'Zeyad cannot read the ledger through ledger_feed');

select is(tests.rows_in('select 1 from account_balances where balance <> 0'), 0::bigint,
  'Zeyad cannot read balances through account_balances');

select is(tests.rows_in('select 1 from personal_entries'), 0::bigint,
  'Zeyad cannot read Ghada''s personal book');

select throws_ok(
  $$insert into member_expenses (family_id, person_id, category_id, amount_egp, occurred_on, status)
    values ('aaaaaaaa-0000-4000-8000-000000000001','bbbb0000-0000-4000-8000-000000000003',
            'dddd0000-0000-4000-8000-000000000001', 100, current_date, 'approved')$$,
  '42501', null, 'Zeyad cannot file his own expense pre-approved');

select throws_ok(
  $$insert into member_expenses (family_id, person_id, category_id, amount_egp, occurred_on)
    values ('aaaaaaaa-0000-4000-8000-000000000001','bbbb0000-0000-4000-8000-000000000004',
            'dddd0000-0000-4000-8000-000000000001', 100, current_date)$$,
  '42501', null, 'Zeyad cannot file an expense in Rewan''s name');

select lives_ok(
  $$insert into member_expenses (family_id, person_id, category_id, amount_egp, occurred_on)
    values ('aaaaaaaa-0000-4000-8000-000000000001','bbbb0000-0000-4000-8000-000000000003',
            'dddd0000-0000-4000-8000-000000000001', 100, current_date)$$,
  'Zeyad CAN file his own, pending');

select is(tests.rows_in('select 1 from member_expenses'), 1::bigint,
  'and then sees only that one row');

-- =====================================================================
-- Joe — the driver. His own days, nothing financial.
-- =====================================================================
select tests.be('55555555-5555-4555-8555-555555555555');

select is(tests.rows_in('select 1 from car_days'), 1::bigint,
  'Joe reads his own car days');

select is(tests.rows_in('select 1 from entries'), 0::bigint,
  'Joe cannot read the family ledger');

select is(tests.rows_in('select 1 from allowances'), 0::bigint,
  'Joe cannot read allowances');

select is(tests.rows_in('select 1 from member_expenses'), 0::bigint,
  'Joe cannot read what the children spend');

select is(tests.rows_in('select 1 from personal_entries'), 0::bigint,
  'Joe cannot read Ghada''s personal book');

-- The leak that prompted 0008: RLS refused him `entries`, and the VIEW over
-- `entries` handed him the rows anyway.
select is(tests.rows_in('select 1 from ledger_feed'), 0::bigint,
  'Joe cannot read the ledger through ledger_feed');

select is(tests.rows_in('select 1 from account_balances where balance <> 0'), 0::bigint,
  'Joe cannot read balances through account_balances');

-- 0012: a day is no longer inserted directly. Letting the client supply the
-- net and the three shares let car_days.direct_egp disagree with the costs
-- itemised beside it — `cd_net_is_derived` only ever compared the day's own
-- columns to each other.
select throws_ok(
  $$insert into car_days (family_id, drive_date, submitted_by,
                          gross_egp, direct_egp, indirect_egp, net_egp,
                          driver_egp, family_egp, marwa_egp)
    values ('aaaaaaaa-0000-4000-8000-000000000001', current_date - 1,
            'bbbb0000-0000-4000-8000-000000000005',
            1000, 0, 0, 1000, 333, 500, 167)$$,
  '42501', null, 'nobody writes a car day directly — record_car_day() only');

select lives_ok(
  $$select record_car_day('aaaaaaaa-0000-4000-8000-000000000001',
      current_date - 1, true, 90000,
      '[{"label":"fuel","class":"direct","amount_egp":15000}]'::jsonb)$$,
  'Joe CAN record a day');

-- D2: the cost comes off before anyone's share. 90,000 − 15,000 = 75,000,
-- and the family's three quarters of what is left after Joe's third is 37,500.
select is(
  (select family_egp from car_days where drive_date = current_date - 1),
  37500::bigint, 'the split is computed in the database, from the costs given');

-- D1: a day off is a RECORDED row. "Joe rested" and "Joe has not sent it in
-- yet" must never look the same.
select lives_ok(
  $$select record_car_day('aaaaaaaa-0000-4000-8000-000000000001',
      current_date - 2, false)$$,
  'Joe CAN record a day off');

select is(
  (select status::text from car_days where drive_date = current_date - 2),
  'off', 'and it is stored as a day off, not as an absence');

-- D10: a large fine on a quiet day. The loss is shared in the same ratios,
-- and is not floored at zero.
select lives_ok(
  $$select record_car_day('aaaaaaaa-0000-4000-8000-000000000001',
      current_date - 3, true, 5000,
      '[{"label":"ticket","class":"indirect","amount_egp":25000}]'::jsonb)$$,
  'Joe CAN record a losing day');

select is(
  (select family_egp from car_days where drive_date = current_date - 3),
  -10000::bigint, 'and the family carries its share of the loss');

-- =====================================================================
-- Ghada — viewer and auditor. Sees everything, changes nothing.
-- =====================================================================
select tests.be('22222222-2222-4222-8222-222222222222');

select cmp_ok(tests.rows_in('select 1 from entries'), '>', 0::bigint,
  'Ghada reads the family ledger');

select cmp_ok(tests.rows_in('select 1 from member_expenses'), '>', 0::bigint,
  'Ghada reads member submissions');

select cmp_ok(tests.rows_in('select 1 from ledger_feed'), '>', 0::bigint,
  'Ghada DOES read the ledger through ledger_feed — locking it down must not break the auditor');

select is(tests.rows_in('select 1 from personal_entries'), 1::bigint,
  'Ghada reads her own personal book');

select throws_ok(
  $$insert into remittances (family_id, from_person, amount_original, currency,
                             fx_rate, amount_egp, received_on, rate_set_by)
    values ('aaaaaaaa-0000-4000-8000-000000000001','bbbb0000-0000-4000-8000-000000000002',
            100, 'SAR', 12.9, 1290, current_date, 'bbbb0000-0000-4000-8000-000000000002')$$,
  '42501', null, 'Ghada cannot record a remittance');

select throws_ok(
  $$insert into allowances (family_id, recipient_id, period, amount_egp, paid_on,
                            paid_by, journal_id)
    values ('aaaaaaaa-0000-4000-8000-000000000001','bbbb0000-0000-4000-8000-000000000003',
            date_trunc('month', current_date)::date, 100, current_date,
            'bbbb0000-0000-4000-8000-000000000002','eeee0000-0000-4000-8000-000000000001')$$,
  '42501', null, 'Ghada cannot pay an allowance');

select lives_ok(
  $$insert into personal_entries (family_id, person_id, direction, category,
                                  amount, currency, occurred_on)
    values ('aaaaaaaa-0000-4000-8000-000000000001','bbbb0000-0000-4000-8000-000000000002',
            'out','p_food', 12000, 'SAR', current_date)$$,
  'Ghada CAN record in her own book');

-- =====================================================================
-- Abdo — admin. Everything, in his family only, except her private book.
-- =====================================================================
select tests.be('11111111-1111-4111-8111-111111111111');

select cmp_ok(tests.rows_in('select 1 from entries'), '>', 0::bigint,
  'Abdo reads the family ledger');

-- The one that defines the feature.
select is(tests.rows_in('select 1 from personal_entries'), 0::bigint,
  'Abdo CANNOT read Ghada''s personal book — he is the family''s accountant, not hers');

select throws_ok(
  $$insert into entries (journal_id, account_id, amount)
    values ('eeee0000-0000-4000-8000-000000000001','cccc0000-0000-4000-8000-000000000001', 1)$$,
  '42501', null, 'not even Abdo writes to the ledger directly — post_journal() only');

-- ------------------------------------------------------------------ 0009
-- post_journal is SECURITY DEFINER, so RLS does not run inside it and the
-- arguments are checked there or nowhere. Before 0009 both of these SUCCEEDED:
-- a legitimate admin could move money into a family he is not in, and the
-- victim saw the balance change with no journal they were allowed to read.
select throws_ok(
  $$select post_journal('aaaaaaaa-0000-4000-8000-000000000001', current_date, 'cross-family',
      jsonb_build_array(
        jsonb_build_object('account_id','cccc0000-0000-4000-8000-000000000004','amount', 5000),
        jsonb_build_object('account_id','cccc0000-0000-4000-8000-000000000001','amount',-5000)))$$,
  '42501', null, 'the admin cannot post a line against another family''s account');

select throws_ok(
  $$select post_journal('aaaaaaaa-0000-4000-8000-000000000001', current_date, 'cross-family name',
      jsonb_build_array(
        jsonb_build_object('account_id','cccc0000-0000-4000-8000-000000000001','amount', 5000,
                           'person_id','bbbb0000-0000-4000-8000-000000000006'),
        jsonb_build_object('account_id','cccc0000-0000-4000-8000-000000000002','amount',-5000)))$$,
  '42501', null, 'the admin cannot put another family''s person on a ledger line');

-- 0012, the hole this all existed to fill: before it, NOTHING ever debited
-- due_from_driver, so the first handover drove it negative and the dashboard
-- read zero however many days Joe had recorded.
-- 37,500 earned on the good day, less 10,000 lost on the bad one.
select is(
  (select balance::bigint from account_balances
    where account_id = 'cccc0000-0000-4000-8000-000000000003'),
  27500::bigint, 'what Joe holds is a receivable from the day he earns it');

-- A mistyped day is voided, never edited: its journal is reversed, so the
-- correction is visible in the ledger rather than silent.
select lives_ok(
  $$select void_car_day((select id from car_days where drive_date = current_date - 3),
                        'recorded twice')$$,
  'the admin voids a day');

select is(
  (select balance::bigint from account_balances
    where account_id = 'cccc0000-0000-4000-8000-000000000003'),
  37500::bigint, 'and voiding it reverses the receivable it created');

-- The handover no longer takes account parameters: it derives cash and
-- due_from_driver from the family itself. 37,000 counted against 37,500 due
-- leaves 500 sitting in the receivable — D12, carried rather than written off.
select lives_ok(
  $$select confirm_handover('aaaaaaaa-0000-4000-8000-000000000001',
      array(select id from car_days
             where drive_date = current_date - 1 and voided_at is null),
      current_date, 37000)$$,
  'the admin confirms a handover without naming the accounts');

select is(
  (select balance::bigint from account_balances
    where account_id = 'cccc0000-0000-4000-8000-000000000003'),
  500::bigint, 'a short handover carries the difference, and does not write it off');

-- =====================================================================
-- 0010 — the allowance: effective-dated, paid once, and what is left.
-- =====================================================================
select lives_ok(
  $$select set_allowance_rate('aaaaaaaa-0000-4000-8000-000000000001',
      'bbbb0000-0000-4000-8000-000000000003', 300000, '2026-01-01')$$,
  'the admin sets Zeyad''s allowance');

select lives_ok(
  $$select set_allowance_rate('aaaaaaaa-0000-4000-8000-000000000001',
      'bbbb0000-0000-4000-8000-000000000003', 400000, '2026-06-01')$$,
  'and raises it from June');

-- D3, and the whole reason rates are a table rather than a column: raising
-- Zeyad in June must not change what March was worth.
select is(allowance_rate_on('bbbb0000-0000-4000-8000-000000000003', '2026-03-15'),
  300000::bigint, 'March still reads 3,000 after a June raise');

select is(allowance_rate_on('bbbb0000-0000-4000-8000-000000000003', '2026-07-15'),
  400000::bigint, 'July reads 4,000');

select lives_ok(
  $$select pay_allowance('aaaaaaaa-0000-4000-8000-000000000001',
      'bbbb0000-0000-4000-8000-000000000003', '2026-03-01', current_date)$$,
  'the admin pays March');

-- Paid at MARCH's rate, not at today's. Backdating a payment must not
-- silently apply a raise that had not happened yet.
select is(
  (select amount_egp from allowances
    where recipient_id = 'bbbb0000-0000-4000-8000-000000000003'
      and period = '2026-03-01'),
  300000::bigint, 'March was paid at March''s rate, not at today''s');

select throws_ok(
  $$select pay_allowance('aaaaaaaa-0000-4000-8000-000000000001',
      'bbbb0000-0000-4000-8000-000000000003', '2026-03-01', current_date)$$,
  -- P0001 is a plain RAISE with no errcode of its own. Spelled out rather
  -- than passed as NULL, which leaves pgTAP unable to pick an overload.
  'P0001', null, 'a month cannot be paid twice');

-- 0011: the rate is read at the END of the period. A rate set part way
-- through a month covers that month — the family's own rates were set on the
-- 4th, and asking for the 1st made September unpayable for six people who
-- visibly had an allowance on screen.
select lives_ok(
  $$select set_allowance_rate('aaaaaaaa-0000-4000-8000-000000000001',
      'bbbb0000-0000-4000-8000-000000000004', 250000, '2026-04-14')$$,
  'the admin sets Rewan''s allowance mid-month');

select lives_ok(
  $$select pay_allowance('aaaaaaaa-0000-4000-8000-000000000001',
      'bbbb0000-0000-4000-8000-000000000004', '2026-04-01', current_date)$$,
  'a rate dated the 14th still pays that whole month');

-- The hole 0010's trigger closes: rates_write checks that the caller is this
-- family's admin and never checked that the recipient is in it.
select throws_ok(
  $$insert into allowance_rates (family_id, recipient_id, amount_egp, effective_from, set_by)
    values ('aaaaaaaa-0000-4000-8000-000000000001',
            'bbbb0000-0000-4000-8000-000000000006', 999, '2026-01-01',
            'bbbb0000-0000-4000-8000-000000000001')$$,
  '42501', null, 'the admin cannot set a rate for another family''s person');

-- security_invoker again: the balances view must scope to the reader.
select tests.be('33333333-3333-4333-8333-333333333333');
select is(tests.rows_in('select 1 from member_balances'), 1::bigint,
  'a member sees ONE row in member_balances — his own');

select tests.be('11111111-1111-4111-8111-111111111111');

-- =====================================================================
-- Cross-tenant. The whole multi-family promise rests on these two.
-- =====================================================================
select tests.be('66666666-6666-4666-8666-666666666666');

select is(tests.rows_in('select 1 from entries'), 0::bigint,
  'another family sees none of the Samboza ledger');

select is(tests.rows_in('select 1 from people where family_id = ''aaaaaaaa-0000-4000-8000-000000000001'''),
  0::bigint, 'another family sees none of the Samboza people');

-- The NULL-role fall-through, fixed in 0009. `if v_me.role <> 'admin'` is
-- NULL — not TRUE — when my_person() finds no row, so the guard did not fire
-- for a caller who is not a member at all. Both of these used to get past the
-- role check and be stopped further down by a constraint: 23514 here, 23502
-- in reverse_journal. A constraint firing is not an authorisation decision.
select throws_ok(
  $$select decide_member_expense('ffff0000-0000-4000-8000-000000000001', 'approved')$$,
  '42501', null, 'a non-member cannot decide a Samboza submission');

select throws_ok(
  $$select reverse_journal('eeee0000-0000-4000-8000-000000000001', 'not yours')$$,
  '42501', null, 'a non-member cannot reverse a Samboza journal');

-- =====================================================================
-- Deactivation takes effect on the NEXT REQUEST, not at token expiry.
-- =====================================================================
select tests.be('11111111-1111-4111-8111-111111111111');
update people set active = false where id = 'bbbb0000-0000-4000-8000-000000000003';

select tests.be('33333333-3333-4333-8333-333333333333');
select is(tests.rows_in('select 1 from member_expenses'), 0::bigint,
  'a deactivated person loses access immediately');

-- =====================================================================
-- Structural: every view in public must obey the caller's permissions.
-- Without this, the next view added reintroduces the leak silently.
-- =====================================================================
select is(
  (select count(*)::bigint
     from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
    where c.relkind = 'v'
      and n.nspname = 'public'
      -- Postgres stores whatever spelling the ALTER used: 'on' from
      -- SET (security_invoker = on), 'true' from = true. Accept either,
      -- or this guard fails on a view that is correctly locked down.
      and not coalesce((
        select lower(option_value) in ('true','on','1')
          from pg_options_to_table(c.reloptions)
         where option_name = 'security_invoker'
      ), false)),
  0::bigint,
  'every view in public has security_invoker on'
);

select * from finish();
rollback;
