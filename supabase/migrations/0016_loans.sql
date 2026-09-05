-- 0016 — what the family owes, and what it is owed.
--
-- §3.5 asks for loans to be registered separately from ordinary income "so
-- the family can see what it owes". Separately in the REPORT; not separately
-- from the ledger — borrowing 10,000 puts 10,000 of real cash in Abdo's hand
-- and a debt beside it, and a system that shows the cash without the debt is
-- lying about how much money the family has.
--
--   borrowed         cash + P   loan_liability  − P     we have it, we owe it
--   repaying it      cash − P   loan_liability  + P     the debt comes down
--   lent out         cash − P   loan_receivable + P     they have it, we are owed
--   they repay us    cash + P   loan_receivable − P
--
-- STATUS AND BALANCE ARE STILL DERIVED. 0005 has the note about why: a stored
-- status and a computed one had already diverged in the blueprint, and this
-- adds the two functions that could have reintroduced it. They do not.

-- Lending needed an account of its own. `loan_liability` is what we owe;
-- money we have lent out is an asset, and putting it in the same account
-- would net the two into a single meaningless number.
insert into accounts (family_id, kind, name, system_key)
select f.id, 'asset', 'Loans owed to us', 'loan_receivable'
  from families f
 where not exists (
   select 1 from accounts a
    where a.family_id = f.id and a.system_key = 'loan_receivable');

alter table loans         add column if not exists voided_at   timestamptz;
alter table loans         add column if not exists void_reason text;
alter table loan_payments add column if not exists voided_at   timestamptz;
alter table loan_payments add column if not exists void_reason text;

-- ---------------------------------------------------------- registering one
create or replace function record_loan(
  p_family       uuid,
  p_direction    text,      -- 'borrowed' | 'lent'
  p_counterparty text,
  p_principal    bigint,    -- PIASTRES
  p_taken_on     date,
  p_description  text default null,
  p_client_uuid  uuid default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_me      people;
  v_cash    uuid;
  v_other   uuid;
  v_journal uuid;
  v_id      uuid;
begin
  v_me := my_person(p_family);
  if v_me.id is null or v_me.role is distinct from 'admin' then
    raise exception 'only the family admin registers a loan'
      using errcode = 'insufficient_privilege';
  end if;

  if p_client_uuid is not null then
    select id into v_id from loans where client_uuid = p_client_uuid;
    if v_id is not null then return v_id; end if;
  end if;

  if p_direction not in ('borrowed','lent') then
    raise exception 'a loan is borrowed or lent, got %', p_direction;
  end if;
  if coalesce(btrim(p_counterparty), '') = '' then
    raise exception 'a loan needs a name — who lent it, or who has it';
  end if;
  if p_principal is null or p_principal <= 0 then
    raise exception 'a loan must be a positive number of piastres';
  end if;
  if p_taken_on > family_today(p_family) then
    raise exception 'that day has not happened yet';
  end if;

  select id into v_cash from accounts where family_id = p_family and system_key = 'cash';
  select id into v_other from accounts
   where family_id = p_family
     and system_key = case when p_direction = 'borrowed'
                           then 'loan_liability' else 'loan_receivable' end;
  if v_cash is null or v_other is null then
    raise exception 'this family has no cash or loan account — run the bootstrap';
  end if;

  v_journal := post_journal_as(
    p_family, v_me.id, p_taken_on,
    coalesce(p_description,
             case when p_direction = 'borrowed' then 'borrowed from ' else 'lent to ' end
             || p_counterparty),
    case when p_direction = 'borrowed' then
      jsonb_build_array(
        jsonb_build_object('account_id', v_cash,  'amount',  p_principal),
        jsonb_build_object('account_id', v_other, 'amount', -p_principal))
    else
      jsonb_build_array(
        jsonb_build_object('account_id', v_other, 'amount',  p_principal),
        jsonb_build_object('account_id', v_cash,  'amount', -p_principal))
    end,
    'loans', null, p_client_uuid);

  insert into loans (family_id, direction, counterparty, principal_egp,
                     taken_on, description, journal_id, client_uuid)
       values (p_family, p_direction, btrim(p_counterparty), p_principal,
               p_taken_on, p_description, v_journal, p_client_uuid)
    returning id into v_id;

  return v_id;
end $$;

-- ------------------------------------------------------------- repaying it
create or replace function record_loan_payment(
  p_loan        uuid,
  p_amount      bigint,
  p_paid_on     date,
  p_client_uuid uuid default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_loan      loans;
  v_me        people;
  v_cash      uuid;
  v_other     uuid;
  v_remaining bigint;
  v_journal   uuid;
  v_id        uuid;
begin
  select * into v_loan from loans where id = p_loan;
  if v_loan.id is null then raise exception 'no such loan'; end if;

  v_me := my_person(v_loan.family_id);
  if v_me.id is null or v_me.role is distinct from 'admin' then
    raise exception 'only the family admin records a repayment'
      using errcode = 'insufficient_privilege';
  end if;

  if p_client_uuid is not null then
    select id into v_id from loan_payments where client_uuid = p_client_uuid;
    if v_id is not null then return v_id; end if;
  end if;

  if v_loan.voided_at is not null then raise exception 'that loan was voided'; end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'a repayment must be a positive number of piastres';
  end if;
  if p_paid_on > family_today(v_loan.family_id) then
    raise exception 'that day has not happened yet';
  end if;

  -- Refusing to over-repay is a typo guard, not accounting pedantry: an extra
  -- zero would drive the balance negative and the loan would read as though
  -- the family were owed money it never lent.
  select v_loan.principal_egp - coalesce(sum(amount_egp), 0)
    into v_remaining
    from loan_payments where loan_id = p_loan and voided_at is null;
  if p_amount > v_remaining then
    raise exception 'that is more than the % still outstanding', v_remaining;
  end if;

  select id into v_cash from accounts
   where family_id = v_loan.family_id and system_key = 'cash';
  select id into v_other from accounts
   where family_id = v_loan.family_id
     and system_key = case when v_loan.direction = 'borrowed'
                           then 'loan_liability' else 'loan_receivable' end;

  v_journal := post_journal_as(
    v_loan.family_id, v_me.id, p_paid_on,
    case when v_loan.direction = 'borrowed' then 'repaid ' else 'repaid by ' end
      || v_loan.counterparty,
    case when v_loan.direction = 'borrowed' then
      jsonb_build_array(
        jsonb_build_object('account_id', v_other, 'amount',  p_amount),
        jsonb_build_object('account_id', v_cash,  'amount', -p_amount))
    else
      jsonb_build_array(
        jsonb_build_object('account_id', v_cash,  'amount',  p_amount),
        jsonb_build_object('account_id', v_other, 'amount', -p_amount))
    end,
    'loan_payments', p_loan, p_client_uuid);

  insert into loan_payments (loan_id, amount_egp, paid_on, journal_id, client_uuid)
       values (p_loan, p_amount, p_paid_on, v_journal, p_client_uuid)
    returning id into v_id;

  return v_id;
end $$;

-- ------------------------------------------------------------- correcting
create or replace function void_loan_payment(p_id uuid, p_reason text)
returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_row loan_payments;
  v_fam uuid;
  v_me  people;
begin
  select * into v_row from loan_payments where id = p_id;
  if v_row.id is null then return false; end if;
  select family_id into v_fam from loans where id = v_row.loan_id;

  v_me := my_person(v_fam);
  if v_me.id is null or v_me.role is distinct from 'admin' then
    raise exception 'only the family admin voids a repayment'
      using errcode = 'insufficient_privilege';
  end if;
  if v_row.voided_at is not null then return false; end if;

  perform post_journal_as(
    v_fam, v_me.id, family_today(v_fam), coalesce(p_reason, 'voided repayment'),
    (select jsonb_agg(jsonb_build_object(
              'account_id', e.account_id, 'amount', -e.amount,
              'person_id', e.person_id, 'category_id', e.category_id))
       from entries e where e.journal_id = v_row.journal_id),
    'loan_payments', p_id, null);

  update loan_payments set voided_at = now(), void_reason = p_reason where id = p_id;
  return true;
end $$;

create or replace function void_loan(p_id uuid, p_reason text)
returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_row loans;
  v_me  people;
begin
  select * into v_row from loans where id = p_id;
  if v_row.id is null then return false; end if;

  v_me := my_person(v_row.family_id);
  if v_me.id is null or v_me.role is distinct from 'admin' then
    raise exception 'only the family admin voids a loan'
      using errcode = 'insufficient_privilege';
  end if;
  if v_row.voided_at is not null then return false; end if;

  -- Voiding a loan that has been partly repaid would leave the repayments
  -- pointing at nothing. Undo them first, deliberately, one at a time.
  if exists (select 1 from loan_payments
              where loan_id = p_id and voided_at is null) then
    raise exception 'that loan has repayments against it — void those first';
  end if;

  perform post_journal_as(
    v_row.family_id, v_me.id, family_today(v_row.family_id),
    coalesce(p_reason, 'voided loan'),
    (select jsonb_agg(jsonb_build_object(
              'account_id', e.account_id, 'amount', -e.amount,
              'person_id', e.person_id, 'category_id', e.category_id))
       from entries e where e.journal_id = v_row.journal_id),
    'loans', p_id, null);

  update loans set voided_at = now(), void_reason = p_reason where id = p_id;
  return true;
end $$;

-- ------------------------------------------------------------- the balance
-- Still derived, and now aware that a voided row is not a row. Rebuilt rather
-- than patched so the whole definition reads in one place.
--
-- DROP then CREATE, not CREATE OR REPLACE: replacing a view can add columns
-- at the end and nothing else — it cannot rename one or slot a new one in
-- between, which is what putting `direction` beside `counterparty` does.
drop view if exists loan_balances;
create view loan_balances as
  select l.id as loan_id,
         l.family_id,
         l.direction,
         l.counterparty,
         l.principal_egp,
         l.taken_on,
         l.description,
         coalesce(sum(p.amount_egp) filter (where p.voided_at is null), 0)
           as repaid_egp,
         l.principal_egp - coalesce(sum(p.amount_egp) filter (where p.voided_at is null), 0)
           as remaining_egp,
         max(p.paid_on) filter (where p.voided_at is null) as last_paid_on,
         case
           when coalesce(sum(p.amount_egp) filter (where p.voided_at is null), 0)
                >= l.principal_egp then 'repaid'
           when coalesce(sum(p.amount_egp) filter (where p.voided_at is null), 0)
                > 0 then 'partial'
           else 'outstanding'
         end as status
    from loans l
    left join loan_payments p on p.loan_id = l.id
   where l.voided_at is null
   group by l.id;

-- CREATE OR REPLACE VIEW does not reliably carry reloptions forward, and a
-- view without this hands every loan to anyone who asks. The RLS suite fails
-- the build if any view in public is missing it — this is belt to that brace.
alter view loan_balances set (security_invoker = on);

-- ------------------------------------------------------------- the door in
drop policy if exists loans_write on loans;
create policy loans_no_direct_write on loans for insert with check (false);
create policy loan_payments_no_direct_write on loan_payments for insert with check (false);

comment on view loan_balances is
  'Principal, repaid and remaining, derived every time. There is no stored '
  'status and there must not be: 0005 exists because a stored one and a '
  'computed one had already disagreed.';
