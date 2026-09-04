-- 0007 — recording a plain income or expense.
--
-- post_journal() takes explicit account lines, which is right for the car and
-- for handovers where the shape genuinely varies. For "Abdo bought groceries"
-- it would mean the app assembling debits and credits, and every screen
-- knowing the sign convention. That knowledge belongs here, once.
--
-- SIGN CONVENTION, stated because it is easy to get backwards:
--   entries.amount is signed piastres, + debit and − credit.
--   assets and expenses are debit-normal  → a positive balance is normal
--   income, liabilities and equity are credit-normal → NEGATIVE is normal
-- So the income accounts carry negative balances and a report flips the sign
-- to show them. That is ordinary double-entry, not a bug to "fix" later.

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
  if v_me.role <> 'admin' then
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

-- ------------------------------------------------------------------ reading
-- One row per movement, already joined to the names a screen needs, so the
-- client is not assembling three queries and guessing at the sign.
--
-- Only the LEDGER lives here. A member's own submissions and the driver's
-- days are separate stores on purpose — the family already expensed the
-- allowance, so counting a member's spending again would double-count it —
-- and History stitches the three together for the admin at read time.
create or replace view ledger_feed as
  select
    e.id                as entry_id,
    j.id                as journal_id,
    j.family_id,
    j.occurred_on,
    j.recorded_at,
    j.memo,
    j.reverses,
    c.id                as category_id,
    c.name_en           as category_en,
    c.name_ar           as category_ar,
    c.colour            as category_colour,
    c.kind              as category_kind,
    p.id                as person_id,
    p.display_name      as person_name,
    a.kind              as account_kind,
    -- Expenses are stored debit-positive; show them as money going out.
    case when a.kind = 'expense' then -e.amount
         when a.kind = 'income'  then -e.amount
         else e.amount end as signed_amount,
    abs(e.amount)       as amount
  from entries e
  join journals   j on j.id = e.journal_id
  join accounts   a on a.id = e.account_id
  left join categories c on c.id = e.category_id
  left join people     p on p.id = e.person_id
  -- One side of each journal is the cash movement; showing both would list
  -- every transaction twice.
  where a.system_key is distinct from 'cash';

comment on view ledger_feed is
  'The family ledger as a screen wants it. RLS still applies: the view is not '
  'SECURITY DEFINER, so entries_read decides who sees a row.';
