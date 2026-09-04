-- 0008 — make the views obey row-level security.
--
-- A LEAK, found by querying as each role rather than by reading the policies.
-- Joe (driver) and Zeyad (member) were correctly refused `entries` — 0 rows —
-- and then handed the same data through `ledger_feed` and `account_balances`.
--
-- Postgres views default to security_invoker = OFF, which means they execute
-- with the privileges of the view's OWNER (postgres) rather than the caller.
-- RLS on the underlying tables is therefore skipped entirely. A comment in
-- 0007 asserted the opposite; asserting it is not the same as testing it.
--
-- Every future view must set this. There is a check in the RLS suite that
-- fails the build if any view in `public` is left with it off, so the mistake
-- cannot be repeated silently.

alter view account_balances set (security_invoker = on);
alter view ledger_feed      set (security_invoker = on);
alter view loan_balances    set (security_invoker = on);

comment on view ledger_feed is
  'The family ledger as a screen wants it. security_invoker is ON, so the '
  'entries_read policy decides who sees a row — verified in the RLS suite, '
  'not merely intended.';

comment on view account_balances is
  'Derived balances. security_invoker is ON: a member or the driver sees '
  'nothing here, exactly as they see nothing in `entries`.';
