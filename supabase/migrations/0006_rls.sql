-- 0006 — row-level security.
--
-- The highest-consequence file in the project. Zeyad seeing Rewan's spending
-- is a family argument, not a bug report. Every policy here has a matching
-- assertion in supabase/tests/rls.test.sql, and several of those assert a
-- DENIAL — those are the ones that matter.

alter table families         enable row level security;
alter table family_invites   enable row level security;
alter table people           enable row level security;
alter table accounts         enable row level security;
alter table categories       enable row level security;
alter table journals         enable row level security;
alter table entries          enable row level security;
alter table period_closes    enable row level security;
alter table remittances      enable row level security;
alter table allowance_rates  enable row level security;
alter table allowances       enable row level security;
alter table member_expenses  enable row level security;
alter table car_handovers    enable row level security;
alter table car_days         enable row level security;
alter table car_expenses     enable row level security;
alter table loans            enable row level security;
alter table loan_payments    enable row level security;
alter table personal_entries enable row level security;

-- ---------------------------------------------------------------- family
create policy families_read on families for select
  using (my_role(id) is not null);

create policy people_read on people for select
  using (my_role(family_id) is not null);

create policy people_write on people for all
  using      (my_role(family_id) = 'admin')
  with check (my_role(family_id) = 'admin');

create policy invites_admin on family_invites for all
  using      (my_role(family_id) = 'admin')
  with check (my_role(family_id) = 'admin');

-- ---------------------------------------------------------------- ledger
-- Only the accountant and the auditor see the family's books. Members see
-- their own sub-ledger; the driver sees his own days. Neither sees this.
create policy accounts_read on accounts for select
  using (my_role(family_id) in ('admin','viewer'));

create policy categories_read on categories for select
  using (my_role(family_id) is not null);      -- everyone needs the names

create policy categories_write on categories for all
  using      (my_role(family_id) = 'admin')
  with check (my_role(family_id) = 'admin');

create policy journals_read on journals for select
  using (my_role(family_id) in ('admin','viewer'));

create policy entries_read on entries for select
  using (exists (
    select 1 from journals j
     where j.id = entries.journal_id
       and my_role(j.family_id) in ('admin','viewer')
  ));

-- Nothing is written to the ledger directly. post_journal() is the only door,
-- so "balanced" and "authorised" are decided in exactly one place.
create policy journals_no_direct_write on journals for insert with check (false);
create policy entries_no_direct_write  on entries  for insert with check (false);

create policy closes_read on period_closes for select
  using (my_role(family_id) in ('admin','viewer'));
create policy closes_write on period_closes for insert
  with check (my_role(family_id) = 'admin');

-- ---------------------------------------------------------------- money
create policy remittances_read on remittances for select
  using (my_role(family_id) in ('admin','viewer'));
create policy remittances_write on remittances for all
  using      (my_role(family_id) = 'admin')
  with check (my_role(family_id) = 'admin');

create policy rates_read on allowance_rates for select
  using (
    my_role(family_id) in ('admin','viewer')
    or recipient_id = (my_person(family_id)).id     -- you may see your own
  );
create policy rates_write on allowance_rates for all
  using      (my_role(family_id) = 'admin')
  with check (my_role(family_id) = 'admin');

create policy allowances_read on allowances for select
  using (
    my_role(family_id) in ('admin','viewer')
    or recipient_id = (my_person(family_id)).id
  );
create policy allowances_write on allowances for all
  using      (my_role(family_id) = 'admin')
  with check (my_role(family_id) = 'admin');

-- --------------------------------------------------- member sub-ledger
create policy me_read on member_expenses for select
  using (
    person_id = (my_person(family_id)).id           -- my own
    or my_role(family_id) in ('admin','viewer')     -- accountant and auditor
  );

-- A member files their own, always pending. `status = 'pending'` in the
-- WITH CHECK is what stops anyone approving their own spending.
create policy me_insert on member_expenses for insert
  with check (
    my_role(family_id) = 'member'
    and person_id = (my_person(family_id)).id
    and status = 'pending'
  );

-- Deciding goes through decide_member_expense(), never a direct update.
create policy me_no_direct_update on member_expenses for update using (false);

-- ---------------------------------------------------------------- car
create policy car_days_read on car_days for select
  using (
    submitted_by = (my_person(family_id)).id
    or my_role(family_id) in ('admin','viewer')
  );

-- The driver records; he cannot mark his own day settled.
create policy car_days_insert on car_days for insert
  with check (
    my_role(family_id) = 'driver'
    and submitted_by = (my_person(family_id)).id
    and status in ('recorded','off')
    and handover_id is null
  );

create policy car_days_no_direct_update on car_days for update using (false);

create policy car_expenses_read on car_expenses for select
  using (exists (
    select 1 from car_days d
     where d.id = car_expenses.car_day_id
       and (d.submitted_by = (my_person(d.family_id)).id
            or my_role(d.family_id) in ('admin','viewer'))
  ));

create policy car_expenses_insert on car_expenses for insert
  with check (exists (
    select 1 from car_days d
     where d.id = car_expenses.car_day_id
       and d.submitted_by = (my_person(d.family_id)).id
       and d.status <> 'settled'
  ));

create policy handovers_read on car_handovers for select
  using (my_role(family_id) in ('admin','viewer','driver'));
create policy handovers_write on car_handovers for insert
  with check (false);          -- confirm_handover() only

-- ---------------------------------------------------------------- loans
create policy loans_read on loans for select
  using (my_role(family_id) in ('admin','viewer'));
create policy loans_write on loans for all
  using      (my_role(family_id) = 'admin')
  with check (my_role(family_id) = 'admin');

create policy loan_payments_read on loan_payments for select
  using (exists (
    select 1 from loans l
     where l.id = loan_payments.loan_id
       and my_role(l.family_id) in ('admin','viewer')
  ));

-- ------------------------------------------------------ personal books
-- This one policy IS the feature. Abdo is the family's accountant, not
-- Ghada's. If this ever grows `or my_role(family_id) = 'admin'`, the book
-- stops being personal.
create policy personal_owner_only on personal_entries for all
  using      (person_id = (my_person(family_id)).id)
  with check (person_id = (my_person(family_id)).id);
