import { useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { useT, money } from '../lib/i18n'
import { useLoad } from '../lib/useLoad'
import type { Family, Person, Role } from '../lib/supabase'
import {
  fmtDay, loanPayments, loans, newClientUuid, recordLoan, recordLoanPayment,
  toPiastres, today, voidLoan, voidLoanPayment,
  type LoanBalance, type LoanDirection, type LoanPayment,
} from '../lib/data'

interface Ctx { person: Person; family: Family; code: string }

/**
 * What the family owes, and what it is owed.
 *
 * §3.5 asks for loans "registered separately from ordinary income so the
 * family can see what it owes" — separately in the REPORT, which is this
 * screen, and not separately from the ledger. Borrowing 10,000 puts 10,000 of
 * real cash in Abdo's hand and a debt beside it, and a dashboard that shows
 * the cash without the debt is lying about how much money the family has.
 *
 * Nothing here is a stored total. `loan_balances` derives principal, repaid
 * and remaining every time it is read, because a stored status and a computed
 * one had already disagreed once before any of this was built.
 */
export default function Loans() {
  const { person, family } = useOutletContext<Ctx>()
  const { t, lang } = useT()
  const isAdmin = (person.role as Role) === 'admin'

  const [err, setErr] = useState<string | null>(null)
  const [open, setOpen] = useState<string | null>(null)

  const load = useLoad(async () => {
    const list = await loans(family.id)
    const payments = await loanPayments(list.map(l => l.loan_id))
    return { list, payments }
  }, [family.id])

  const d = load.data
  const pending = load.loading || load.failed
  const live = (d?.list ?? []).filter(l => l.status !== 'repaid')
  const weOwe = live.filter(l => l.direction === 'borrowed')
    .reduce((a, l) => a + l.remaining_egp, 0)
  const owedToUs = live.filter(l => l.direction === 'lent')
    .reduce((a, l) => a + l.remaining_egp, 0)

  return (
    <div className="stack">
      <div className="kpis">
        <Kpi label={t('ln_we_owe')} pending={pending} value={money(weOwe, lang)}
             tone={weOwe > 0 ? 'out' : undefined} note={t('ln_we_owe_note')} />
        <Kpi label={t('ln_owed_to_us')} pending={pending} value={money(owedToUs, lang)}
             tone={owedToUs > 0 ? 'in' : undefined} />
        <Kpi label={t('ln_open')} pending={pending} value={String(live.length)} />
      </div>

      {err && <div className="notice warn">{err}</div>}

      {isAdmin && <NewLoan family={family} onSaved={load.reload} />}

      <div className="card">
        <div className="cardhead"><h2>{t('nav_loans')}</h2></div>
        <p className="sub">{t('ln_sub')}</p>

        {load.loading && <p className="sub" style={{ padding: '14px 0' }}>{t('loading')}</p>}
        {load.failed && (
          <p className="sub" style={{ padding: '14px 0' }}>
            {t('err_load')} <button className="linkbtn" onClick={load.reload}>{t('retry')}</button>
          </p>
        )}
        {!pending && !d?.list.length && (
          <p className="sub" style={{ padding: '14px 0' }}>{t('ln_none')}</p>
        )}

        <div className="rows">
          {d?.list.map(l => (
            <LoanRow key={l.loan_id} loan={l} lang={lang} isAdmin={isAdmin}
                     payments={d.payments.filter(p => p.loan_id === l.loan_id)}
                     open={open === l.loan_id}
                     onToggle={() => setOpen(open === l.loan_id ? null : l.loan_id)}
                     onDone={load.reload} onError={setErr} />
          ))}
        </div>
      </div>
    </div>
  )
}

function LoanRow({ loan, lang, isAdmin, payments, open, onToggle, onDone, onError }: {
  loan: LoanBalance; lang: 'en' | 'ar'; isAdmin: boolean; payments: LoanPayment[]
  open: boolean; onToggle: () => void; onDone: () => void; onError: (m: string) => void
}) {
  const { t } = useT()
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState(today())
  const [busy, setBusy] = useState(false)
  const done = loan.status === 'repaid'

  async function pay() {
    const p = toPiastres(amount)
    if (!p) return onError(t('err_amount'))
    setBusy(true)
    try {
      await recordLoanPayment({ loanId: loan.loan_id, amount: p, paidOn: date, clientUuid: newClientUuid() })
      setAmount('')
      onDone()
    } catch (e) {
      onError((e as { message?: string }).message ?? t('err_load'))
    } finally { setBusy(false) }
  }

  async function drop() {
    setBusy(true)
    try {
      await voidLoan(loan.loan_id, t('ln_void_default'))
      onDone()
    } catch (e) {
      onError((e as { message?: string }).message ?? t('err_load'))
    } finally { setBusy(false) }
  }

  return (
    <div className="row alrow">
      <div className="dot" style={{
        background: done ? 'var(--neutral)'
          : loan.direction === 'borrowed' ? 'var(--expense)' : 'var(--trend)',
      }} />
      <div className="rowmain">
        <div className="rowtitle">
          {loan.counterparty}
          <span className="badge">{t(`ln_${loan.direction}` as any)}</span>
          <span className={'badge ' + (done ? 'approved' : loan.status === 'partial' ? 'pending' : '')}>
            {t(`ln_st_${loan.status}` as any)}
          </span>
        </div>
        <div className="rowsub">
          {fmtDay(loan.taken_on, lang)} · {money(loan.principal_egp, lang)}
          {loan.repaid_egp > 0 && <> · {t('ln_repaid')} {money(loan.repaid_egp, lang)}</>}
          {loan.description && <> · {loan.description}</>}
        </div>
      </div>

      {/* The remaining balance is the number that matters, so it is the one in
          the amount column — the principal is history. */}
      <div className={'amt ' + (done ? '' : loan.direction === 'borrowed' ? 'minus' : 'plus')}>
        {money(loan.remaining_egp, lang)}
      </div>

      {isAdmin && !done && (
        <button className="btn sm ghost" onClick={onToggle}>{t('ln_repay')}</button>
      )}

      {open && isAdmin && (
        <div className="rateedit">
          <div className="field">
            <label>{`${t('ln_repayment')} (${t('f_amount_unit')})`}</label>
            <input className="input" inputMode="decimal" value={amount} autoFocus
                   onChange={e => setAmount(e.target.value)}
                   placeholder={(loan.remaining_egp / 100).toFixed(2)} />
          </div>
          <div className="field">
            <label>{t('f_date')}</label>
            <input className="input" type="date" value={date} max={today()}
                   onChange={e => setDate(e.target.value)} />
          </div>
          <button className="btn sm" disabled={busy} onClick={() => void pay()}>
            {busy ? t('saving') : t('ln_record_repayment')}
          </button>
          <p className="hint">{t('ln_repay_note')}</p>

          {!!payments.length && (
            <div className="paylist">
              {payments.map(p => (
                <div className="payline" key={p.id}>
                  <span>{fmtDay(p.paid_on, lang)}</span>
                  <span className="amt">{money(p.amount_egp, lang)}</span>
                  <button className="linkbtn inline" disabled={busy}
                          onClick={async () => {
                            setBusy(true)
                            try { await voidLoanPayment(p.id, t('ln_void_default')); onDone() }
                            catch (e) { onError((e as { message?: string }).message ?? t('err_load')) }
                            finally { setBusy(false) }
                          }}>
                    {t('car_void')}
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Only while nothing has been repaid: voiding a loan with
              repayments against it would leave them pointing at nothing, so
              the database refuses and says so. */}
          {!payments.length && (
            <button className="linkbtn inline" disabled={busy} onClick={() => void drop()}>
              {t('ln_void')}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function NewLoan({ family, onSaved }: { family: Family; onSaved: () => void }) {
  const { t } = useT()
  const [direction, setDirection] = useState<LoanDirection>('borrowed')
  const [counterparty, setCounterparty] = useState('')
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState(today())
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [clientUuid, setClientUuid] = useState(newClientUuid)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setErr(null)
    const p = toPiastres(amount)
    if (!counterparty.trim()) return setErr('ln_err_who')
    if (!p) return setErr('err_amount')
    if (date > today()) return setErr('err_future')

    setBusy(true)
    try {
      await recordLoan({
        familyId: family.id, direction, counterparty: counterparty.trim(),
        principal: p, takenOn: date, description: description || null, clientUuid,
      })
      setCounterparty(''); setAmount(''); setDescription('')
      setClientUuid(newClientUuid())
      onSaved()
    } catch (e) {
      setErr((e as { message?: string }).message ?? 'err_load')
    } finally { setBusy(false) }
  }

  return (
    <form className="card form wide-form" onSubmit={submit}>
      <div className="cardhead"><h2>{t('ln_new')}</h2></div>

      <div className="seg" style={{ marginTop: 16 }}>
        {(['borrowed', 'lent'] as const).map(k => (
          <button key={k} type="button"
                  className={'segbtn' + (direction === k ? ' on' : '')}
                  onClick={() => setDirection(k)}>
            {t(`ln_${k}` as any)}
          </button>
        ))}
      </div>
      <p className="sub" style={{ marginBlockStart: 8 }}>
        {t(direction === 'borrowed' ? 'ln_borrowed_note' : 'ln_lent_note')}
      </p>

      <div className="grid2">
        <div className="field">
          <label>{t(direction === 'borrowed' ? 'ln_from_who' : 'ln_to_who')}</label>
          <input className="input" value={counterparty} autoFocus
                 onChange={e => setCounterparty(e.target.value)} />
        </div>
        <div className="field">
          <label>{`${t('f_amount')} (${t('f_amount_unit')})`}</label>
          <input className="input" inputMode="decimal" value={amount}
                 onChange={e => setAmount(e.target.value)} placeholder="0.00" />
        </div>
      </div>

      <div className="grid2">
        <div className="field">
          <label>{t('ln_taken_on')}</label>
          <input className="input" type="date" value={date} max={today()}
                 onChange={e => setDate(e.target.value)} />
        </div>
        <div className="field">
          <label>{t('f_memo')} <span className="opt">· {t('f_optional')}</span></label>
          <input className="input" value={description}
                 onChange={e => setDescription(e.target.value)} />
        </div>
      </div>

      {err && <p className="errmsg">{/^[a-z_]+$/.test(err) ? t(err as any) : err}</p>}

      <button className="btn wide" style={{ marginTop: 20 }} disabled={busy}>
        {busy ? t('saving') : t('ln_register')}
      </button>
    </form>
  )
}

function Kpi({ label, value, tone, note, pending }: {
  label: string; value: string; tone?: 'in' | 'out'; note?: string; pending?: boolean
}) {
  return (
    <div className="kpi">
      <div className="k">{label}</div>
      <div className={'v' + (pending ? ' muted' : tone ? ' ' + tone : '')}>
        {pending ? '—' : value}
      </div>
      {note && <div className="n">{note}</div>}
    </div>
  )
}
