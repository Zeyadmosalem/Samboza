-- 0009 — a SECURITY DEFINER function must not trust its arguments.
--
-- Found by the Pass 1 audit, and PROVEN rather than reasoned about. Signed in
-- as Abdo — a legitimate admin of Samboza — a second family was created and a
-- journal line posted against ITS cash account. It worked. Abdo could not read
-- the journal back afterwards, because entries_read scopes to the journal's
-- family; the other family's account_balances silently included the amount,
-- with no journal they were permitted to see to explain it. Corruption they
-- cannot audit is worse than corruption they can.
--
-- The policies were not wrong. RLS never ran. post_journal is SECURITY
-- DEFINER: it executes as the table owner, so its own checks ARE the checks,
-- and it validated the CALLER while trusting every id the caller handed it.
--
-- Three instances of one mistake are fixed here:
--
--   post_journal        account_id / person_id / category_id may be any row
--                       in the database, in any family.
--   confirm_handover    the cash and receivable accounts arrived as
--                       parameters — the caller chose where the money landed.
--   record_transaction  p_person may be anyone. Lower impact (it is reporting
--                       attribution, not the money) but the same class.
--
-- And a fourth, latent, in four functions:
--
--   `if v_me.role <> 'admin' then raise` is NULL — not TRUE — when my_person()
--   returns no row, which is exactly the case where the caller is not a member
--   of that family at all. A NULL condition does not take the branch, so the
--   guard falls through for the one person it was written to stop.
--   post_journal tested `v_me.id is null` first and was safe. reverse_journal,
--   record_transaction, confirm_handover and decide_member_expense were not:
--   each was saved only by a NOT NULL or CHECK constraint failing later, which
--   is an accident, not a control. They now all fail closed, with 42501.

-- ------------------------------------------------------------ post_journal
create or replace function post_journal(
  p_family       uuid,
  p_occurred_on  date,
  p_memo         text,
  p_lines        jsonb,          -- [{account_id, amount, person_id?, category_id?}]
  p_source_table text default null,
  p_source_id    uuid default null,
  p_client_uuid  uuid default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_me      people;
  v_journal uuid;
  v_line    jsonb;
  v_total   bigint := 0;
begin
  v_me := my_person(p_family);
  if v_me.id is null then
    raise exception 'not a member of this family' using errcode = 'insufficient_privilege';
  end if;
  if v_me.role is distinct from 'admin' then
    raise exception 'only the family admin posts to the ledger'
      using errcode = 'insufficient_privilege';
  end if;

  -- Idempotent: a retry with the same client_uuid returns the first journal
  -- rather than posting a second one.
  if p_client_uuid is not null then
    select id into v_journal from journals where client_uuid = p_client_uuid;
    if v_journal is not null then return v_journal; end if;
  end if;

  if jsonb_array_length(p_lines) < 2 then
    raise exception 'a journal needs at least two lines';
  end if;

  -- ---------------------------------------------------------------------
  -- THE FIX. Every id named in the lines must belong to p_family.
  --
  -- This function bypasses RLS by design, so there is no second checker
  -- behind it. An unknown account_id is refused for the same reason a
  -- foreign one is: both mean the caller named a row this journal has no
  -- business touching, and the foreign-key error it would otherwise raise
  -- leaks whether that id exists.
  -- ---------------------------------------------------------------------
  if exists (
    select 1
      from jsonb_array_elements(p_lines) l
      left join accounts a on a.id = nullif(l->>'account_id','')::uuid
     where a.id is null or a.family_id <> p_family
  ) then
    raise exception 'every line must post to an account in this family'
      using errcode = 'insufficient_privilege';
  end if;

  -- person_id and category_id are optional, so these join rather than left
  -- join: a line that names nobody is fine, a line that names somebody
  -- else's person or category is not.
  if exists (
    select 1
      from jsonb_array_elements(p_lines) l
      join people p on p.id = nullif(l->>'person_id','')::uuid
     where p.family_id <> p_family
  ) then
    raise exception 'a journal line names a person from another family'
      using errcode = 'insufficient_privilege';
  end if;

  if exists (
    select 1
      from jsonb_array_elements(p_lines) l
      join categories c on c.id = nullif(l->>'category_id','')::uuid
     where c.family_id <> p_family
  ) then
    raise exception 'a journal line names a category from another family'
      using errcode = 'insufficient_privilege';
  end if;

  insert into journals (family_id, occurred_on, recorded_by, memo,
                        source_table, source_id, client_uuid)
       values (p_family, p_occurred_on, v_me.id, p_memo,
               p_source_table, p_source_id, p_client_uuid)
    returning id into v_journal;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    insert into entries (journal_id, account_id, amount, person_id, category_id)
    values (
      v_journal,
      (v_line->>'account_id')::uuid,
      (v_line->>'amount')::bigint,
      nullif(v_line->>'person_id','')::uuid,
      nullif(v_line->>'category_id','')::uuid
    );
    v_total := v_total + (v_line->>'amount')::bigint;
  end loop;

  if v_total <> 0 then
    raise exception 'journal does not balance: lines sum to %', v_total
      using errcode = 'check_violation';
  end if;

  return v_journal;
end $$;

-- --------------------------------------------------------- reverse_journal
create or replace function reverse_journal(p_journal uuid, p_memo text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_src     journals;
  v_me      people;
  v_journal uuid;
begin
  select * into v_src from journals where id = p_journal;
  -- Deliberately the same message and code as "you are not allowed to":
  -- distinguishing them tells a caller which journal ids exist.
  if v_src.id is null then
    raise exception 'no such journal' using errcode = 'insufficient_privilege';
  end if;

  v_me := my_person(v_src.family_id);
  if v_me.id is null or v_me.role is distinct from 'admin' then
    raise exception 'only the family admin reverses a journal'
      using errcode = 'insufficient_privilege';
  end if;

  insert into journals (family_id, occurred_on, recorded_by, memo, reverses)
       values (v_src.family_id, current_date, v_me.id,
               coalesce(p_memo, 'reversal'), p_journal)
    returning id into v_journal;

  -- The accounts come from the journal being reversed, so they are already
  -- in the right family by construction. Nothing to validate.
  insert into entries (journal_id, account_id, amount, person_id, category_id)
  select v_journal, account_id, -amount, person_id, category_id
    from entries where journal_id = p_journal;

  return v_journal;
end $$;

-- ------------------------------------------------------ record_transaction
create or replace function record_transaction(
  p_family      uuid,
  p_kind        text,      -- 'income' | 'expense'
  p_category    uuid,
  p_amount      bigint,    -- PIASTRES, always positive
  p_occurred_on date,
  p_person      uuid default null,   -- on behalf of, for reporting
  p_memo        text default null,
  p_client_uuid uuid default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_me       people;
  v_cash     uuid;
  v_category categories;
  v_lines    jsonb;
begin
  if p_kind not in ('income','expense') then
    raise exception 'kind must be income or expense, got %', p_kind;
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'amount must be a positive number of piastres';
  end if;
  if p_occurred_on > current_date then
    raise exception 'that day has not happened yet';
  end if;

  v_me := my_person(p_family);
  if v_me.id is null or v_me.role is distinct from 'admin' then
    raise exception 'only the family admin records to the ledger'
      using errcode = 'insufficient_privilege';
  end if;

  select * into v_category from categories
   where id = p_category and family_id = p_family and active;
  if v_category.id is null then
    raise exception 'no such category in this family';
  end if;
  if v_category.kind <> p_kind then
    raise exception 'category % is an % category, not %',
      v_category.name_en, v_category.kind, p_kind;
  end if;

  -- The category was already scoped to the family; the person was not.
  -- "On behalf of" is reporting rather than money, so the blast radius is
  -- small — but a foreign name on a family's ledger line is still wrong.
  if p_person is not null and not exists (
    select 1 from people where id = p_person and family_id = p_family
  ) then
    raise exception 'that person is not in this family'
      using errcode = 'insufficient_privilege';
  end if;

  -- D7: a gift records who received it.
  if v_category.needs_recipient and p_person is null then
    raise exception 'category % needs a recipient', v_category.name_en;
  end if;

  select id into v_cash from accounts
   where family_id = p_family and system_key = 'cash';
  if v_cash is null then
    raise exception 'this family has no cash account — run the bootstrap';
  end if;

  -- Expense: the category account takes the charge, cash goes down.
  -- Income:  cash goes up, the income account is credited.
  if p_kind = 'expense' then
    v_lines := jsonb_build_array(
      jsonb_build_object('account_id', v_category.account_id, 'amount',  p_amount,
                         'category_id', p_category, 'person_id', p_person),
      jsonb_build_object('account_id', v_cash, 'amount', -p_amount)
    );
  else
    v_lines := jsonb_build_array(
      jsonb_build_object('account_id', v_cash, 'amount',  p_amount),
      jsonb_build_object('account_id', v_category.account_id, 'amount', -p_amount,
                         'category_id', p_category, 'person_id', p_person)
    );
  end if;

  return post_journal(p_family, p_occurred_on, p_memo, v_lines,
                      'record_transaction', null, p_client_uuid);
end $$;

-- --------------------------------------------------- decide_member_expense
create or replace function decide_member_expense(
  p_id uuid, p_status submission_status, p_reason text default null
) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_row member_expenses;
  v_me  people;
begin
  select * into v_row from member_expenses where id = p_id;
  if v_row.id is null then return false; end if;

  v_me := my_person(v_row.family_id);
  if v_me.id is null or v_me.role is distinct from 'admin' then
    raise exception 'only the family admin decides submissions'
      using errcode = 'insufficient_privilege';
  end if;
  if p_status = 'pending' then
    raise exception 'cannot move a submission back to pending';
  end if;

  update member_expenses
     set status = p_status, decided_by = v_me.id, decided_at = now(), reason = p_reason
   where id = p_id and status = 'pending';

  return found;
end $$;

-- ------------------------------------------------------- confirm_handover
-- The old signature took p_cash_account and p_due_account from the caller.
-- Even with post_journal now validating the family, letting a caller choose
-- WHICH of their accounts receives the cash is a decision the function should
-- be making: there is exactly one right answer and it is derivable. Dropped
-- rather than deprecated, so no client can keep passing them.
drop function if exists confirm_handover(uuid, uuid[], date, bigint, uuid, uuid, text, uuid);

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
     and status = 'recorded';          -- the guard

  if v_count = 0 then
    raise exception 'no unsettled days in that selection';
  end if;

  -- Looked up, not passed in. There is one cash account and one receivable
  -- per family, and the function knows which they are.
  select id into v_cash from accounts where family_id = p_family and system_key = 'cash';
  select id into v_due  from accounts where family_id = p_family and system_key = 'due_from_driver';
  if v_cash is null or v_due is null then
    raise exception 'this family has no cash or due_from_driver account — run the bootstrap';
  end if;

  -- Cash in for what was actually counted; the receivable clears by the same
  -- amount, so any shortfall simply stays in due_from_driver (D12).
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
   where family_id = p_family and id = any (p_day_ids) and status = 'recorded';

  return v_handover;
end $$;

comment on function post_journal(uuid, date, text, jsonb, text, uuid, uuid) is
  'The only door into the ledger. SECURITY DEFINER, so RLS does not run '
  'inside it and every argument is validated here or nowhere: the caller '
  'must be this family''s admin, and every account, person and category '
  'named in the lines must belong to the same family.';
