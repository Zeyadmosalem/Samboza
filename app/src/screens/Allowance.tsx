import { useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { useT, money } from '../lib/i18n'
import { useLoad } from '../lib/useLoad'
import { supabase, type Family, type Person, type Role } from '../lib/supabase'
import {
  allowancesFor, memberBalances, monthLabel, monthStart, newClientUuid,
  nextMonthStart, payAllowance, setAllowanceRate, toPiastres, today,
  type MemberBalance,
} from '../lib/data'

interface Ctx { person: Person; family: Family; code: string }

/**
 * Who gets what, whether this month is paid, and what is left of it.
 *
 * Abdo acts here; Ghada reads the same screen with the buttons gone. That is
 * a courtesy — every write goes through `pay_allowance` or
 * `set_allowance_rate`, and both refuse anyone who is not this family's
 * admin, so hiding a button is presentation and never the control.
 *
 * A "balance" only means something for someone who submits what they spend.
 * Mona, Grandma, Marwa and Adam & Anas receive the allowance and that is the
 * end of the trail (§3.3), so their row shows what they were paid and no
 * balance at all rather than a number that quietly implies they overspent.
 */
export default function Allowance() {
  const { person, family } = useOutletContext<Ctx>()
  const { t, lang } = useT()
  const canPay = (person.role as Role) === 'admin'

  const [period, setPeriod] = useState(monthStart())
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<string | null>(null)
  const [editing, setEditing] = useState<string | null>(null)

  const load = useLoad(async () => {
    const [people, bal, paid] = await Promise.all([
      supabase.from('people').select('id,display_name,role,active')
        .eq('family_id', family.id).eq('active', true).order('member_no')
        .then(r => { if (r.error) throw r.error; return r.data as PersonRow[] }),
      memberBalances(family.id),
      allowancesFor(family.id, period),
    ])
    return { people, bal, paid }
  }, [family.id, period])

  const d = load.data
  // Everyone the family actually pays: a rate exists, or one used to and the
  // history is still worth showing.
  const rows = (d?.bal ?? [])
    .map(b => ({ b, who: d!.people.find(p => p.id === b.person_id) }))
    .filter(r => r.who)
    .sort((a, b) => (b.b.rate ?? 0) - (a.b.rate ?? 0) ||
                    a.who!.display_name.localeCompare(b.who!.display_name))

  async function pay(recipientId: string) {
    setErr(null); setBusy(recipientId)
    try {
      await payAllowance({
        familyId: family.id, recipientId, period, paidOn: today(),
        clientUuid: newClientUuid(),
      })
      setConfirming(null)
      load.reload()
    } catch (e) {
      setErr((e as { message?: string }).message ?? t('err_load'))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="stack">
      <div className="card">
        <div className="cardhead">
          <h2>{monthLabel(period, lang)}</h2>
          <div className="seg">
            <button className="segbtn" onClick={() => setPeriod(shiftMonth(period, -1))}>‹</button>
            <button className="segbtn" disabled={period >= monthStart()}
                    onClick={() => setPeriod(shiftMonth(period, 1))}>›</button>
          </div>
        </div>
        <p className="sub">{canPay ? t('al_sub_admin') : t('al_sub_viewer')}</p>
      </div>

      {err && <div className="notice warn">{err}</div>}

      <div className="card">
        {load.loading && <p className="sub" style={{ padding: '14px 0' }}>{t('loading')}</p>}
        {load.failed && (
          <p className="sub" style={{ padding: '14px 0' }}>
            {t('err_load')} <button className="linkbtn" onClick={load.reload}>{t('retry')}</button>
          </p>
        )}
        {!load.loading && !load.failed && !rows.length && (
          <p className="sub" style={{ padding: '14px 0' }}>{t('al_nobody')}</p>
        )}

        <div className="rows">
          {rows.map(({ b, who }) => {
            const payment = d!.paid.find(p => p.recipient_id === b.person_id)
            const submits = who!.role === 'member'
            const owed = b.rate ?? 0
            return (
              <div className="row alrow" key={b.person_id}>
                <div className="rowmain">
                  <div className="rowtitle">
                    {who!.display_name}
                    {payment
                      ? <span className="badge approved">{t('al_paid')}</span>
                      : owed > 0 && <span className="badge pending">{t('al_unpaid')}</span>}
                  </div>
                  <div className="rowsub">
                    {owed > 0 ? `${money(owed, lang)} · ${t('al_monthly')}` : t('al_no_rate')}
                    {submits && <> · {t('al_received')} {money(b.received, lang)}</>}
                    {submits && b.pending_count > 0 &&
                      <> · {t('kpi_pending')} {money(b.pending, lang)}</>}
                  </div>
                </div>

                {submits && (
                  <div className={'amt ' + (b.balance >= 0 ? 'plus' : 'minus')}>
                    {money(b.balance, lang)}
                  </div>
                )}

                {canPay && !payment && owed > 0 && (
                  confirming === b.person_id ? (
                    <div className="rowact">
                      <button className="btn sm" disabled={busy === b.person_id}
                              onClick={() => void pay(b.person_id)}>
                        {busy === b.person_id ? t('saving') : `${t('al_confirm')} ${money(owed, lang)}`}
                      </button>
                      <button className="btn sm ghost" onClick={() => setConfirming(null)}>
                        {t('al_cancel')}
                      </button>
                    </div>
                  ) : (
                    <button className="btn sm ghost"
                            onClick={() => { setErr(null); setConfirming(b.person_id) }}>
                      {t('al_pay')}
                    </button>
                  )
                )}

                {canPay && (
                  <button className="linkbtn inline"
                          onClick={() => setEditing(editing === b.person_id ? null : b.person_id)}>
                    {t('al_change_rate')}
                  </button>
                )}

                {canPay && editing === b.person_id && (
                  <RateEditor
                    familyId={family.id}
                    recipientId={b.person_id}
                    current={b.rate}
                    onDone={() => { setEditing(null); load.reload() }}
                  />
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

interface PersonRow { id: string; display_name: string; role: Role | null; active: boolean }

/**
 * A raise defaults to the FIRST OF NEXT MONTH, not today. Backdating into a
 * month that has already been paid is legal and occasionally right, but it is
 * never what someone means by "give Zeyad a bit more", and the effective date
 * is the whole reason March keeps reading as March.
 */
function RateEditor({ familyId, recipientId, current, onDone }: {
  familyId: string; recipientId: string; current: number | null; onDone: () => void
}) {
  const { t } = useT()
  const [amount, setAmount] = useState(current != null ? String(current / 100) : '')
  const [from, setFrom] = useState(nextMonthStart(today()))
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function save() {
    setErr(null)
    const piastres = amount.trim() === '0' ? 0 : toPiastres(amount)
    if (piastres == null) return setErr(t('err_amount'))
    setBusy(true)
    try {
      await setAllowanceRate({ familyId, recipientId, amount: piastres, effectiveFrom: from })
      onDone()
    } catch (e) {
      setErr((e as { message?: string }).message ?? t('err_load'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rateedit">
      <div className="field">
        <label>{t('al_new_rate')}</label>
        <input className="input" inputMode="decimal" value={amount} autoFocus
               onChange={e => setAmount(e.target.value)} placeholder="0.00" />
      </div>
      <div className="field">
        <label>{t('al_from')}</label>
        <input className="input" type="date" value={from}
               onChange={e => setFrom(e.target.value)} />
      </div>
      <button className="btn sm" disabled={busy} onClick={() => void save()}>
        {busy ? t('saving') : t('save')}
      </button>
      <p className="hint">{t('al_rate_note')}</p>
      {err && <p className="errmsg">{err}</p>}
    </div>
  )
}

function shiftMonth(period: string, by: number) {
  const [y, m] = period.split('-').map(Number)
  const d = new Date(y, m - 1 + by, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}

export type { MemberBalance }
