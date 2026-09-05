import { useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { useT, money } from '../lib/i18n'
import { useLoad } from '../lib/useLoad'
import { supabase, type Family, type Person, type Role } from '../lib/supabase'
import {
  CURRENCIES, daysSince, fmtDay, newClientUuid, parseRate, recordRemittance,
  remittances, toEgp, toMinorUnits, today, voidRemittance,
  type Currency, type Remittance,
} from '../lib/data'

interface Ctx { person: Person; family: Family; code: string }

/**
 * What Ghada brings home when she visits.
 *
 * D4: Abdo types the rate himself. There is no rate API and there should not
 * be one — the number that matters is what the two of them actually agreed
 * that day, not what a market said, and storing it beside the original amount
 * is what lets anyone read the row back in a year and see the whole deal.
 *
 * The EGP figure is shown live as he types, and computed AGAIN in SQL when he
 * submits. He should never be surprised by the number, and he should never be
 * the one who supplies it.
 *
 * She reads this screen and cannot write to it. It is her money arriving, and
 * the family's accountant is the one who records it — the same separation as
 * everywhere else, enforced by the database rather than by hiding a button.
 */
export default function Remittance() {
  const { person, family } = useOutletContext<Ctx>()
  const { t, lang } = useT()
  const isAdmin = (person.role as Role) === 'admin'

  const [err, setErr] = useState<string | null>(null)
  const [voiding, setVoiding] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useLoad(async () => {
    const [list, people] = await Promise.all([
      remittances(family.id),
      supabase.from('people').select('id,display_name,role')
        .eq('family_id', family.id).eq('active', true).order('member_no')
        .then(r => { if (r.error) throw r.error; return r.data as PersonRow[] }),
    ])
    return { list, people }
  }, [family.id])

  const d = load.data
  const pending = load.loading || load.failed
  const last = d?.list[0]
  // §3.1: income here is lumpy and tied to visits, so "how long since the last
  // one" tells the family more than any monthly average could.
  const since = last ? daysSince(last.received_on) : null
  const thisYear = (d?.list ?? [])
    .filter(r => r.received_on >= `${new Date().getFullYear()}-01-01`)
    .reduce((a, r) => a + r.amount_egp, 0)

  async function doVoid(id: string) {
    setErr(null); setBusy(true)
    try {
      await voidRemittance(id, reason || t('rm_void_default'))
      setVoiding(null); setReason('')
      load.reload()
    } catch (e) {
      setErr((e as { message?: string }).message ?? t('err_load'))
    } finally { setBusy(false) }
  }

  return (
    <div className="stack">
      <div className="kpis">
        <Kpi label={t('rm_last')} pending={pending}
             value={last ? money(last.amount_egp, lang) : '—'} />
        <Kpi label={t('rm_days_since')} pending={pending}
             value={since == null ? '—' : String(since)}
             note={last ? fmtDay(last.received_on, lang) : undefined} />
        <Kpi label={t('rm_this_year')} pending={pending}
             value={money(thisYear, lang)} tone="in" />
      </div>

      {err && <div className="notice warn">{err}</div>}

      {isAdmin && d && (
        <Form family={family} people={d.people} onSaved={load.reload} />
      )}

      <div className="card">
        <div className="cardhead"><h2>{t('rm_history')}</h2></div>
        <p className="sub">{t('rm_history_sub')}</p>

        {load.loading && <p className="sub" style={{ padding: '14px 0' }}>{t('loading')}</p>}
        {load.failed && (
          <p className="sub" style={{ padding: '14px 0' }}>
            {t('err_load')} <button className="linkbtn" onClick={load.reload}>{t('retry')}</button>
          </p>
        )}
        {!pending && !d?.list.length && (
          <p className="sub" style={{ padding: '14px 0' }}>{t('nothing_yet')}</p>
        )}

        <div className="rows">
          {d?.list.map(r => (
            <div className="row alrow" key={r.id}>
              <div className="dot" style={{ background: 'var(--income)' }} />
              <div className="rowmain">
                <div className="rowtitle">
                  {fmtDay(r.received_on, lang)}
                  <span className="badge">{r.currency}</span>
                </div>
                {/* The original amount and the rate, always — the EGP figure
                    alone is not the record, it is a consequence of it. */}
                <div className="rowsub">
                  {fmtMinor(r.amount_original)} {r.currency} × {fmtRate(r.fx_rate)}
                  {r.visit_note && <> · {r.visit_note}</>}
                </div>
              </div>
              <div className="amt plus">{money(r.amount_egp, lang)}</div>
              {isAdmin && (
                <button className="linkbtn inline"
                        onClick={() => { setVoiding(voiding === r.id ? null : r.id); setReason('') }}>
                  {t('car_void')}
                </button>
              )}
              {voiding === r.id && (
                <div className="rateedit">
                  <div className="field">
                    <label>{t('car_void_why')}</label>
                    <input className="input" value={reason} autoFocus
                           onChange={e => setReason(e.target.value)} />
                  </div>
                  <button className="btn sm" disabled={busy} onClick={() => void doVoid(r.id)}>
                    {t('rm_void_confirm')}
                  </button>
                  <p className="hint">{t('rm_void_note')}</p>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

interface PersonRow { id: string; display_name: string; role: Role | null }

function Form({ family, people, onSaved }: {
  family: Family; people: PersonRow[]; onSaved: () => void
}) {
  const { t, lang } = useT()
  // Ghada is who this is, in practice — but the field is a field, because
  // "the person who sends money home" is a role a family can reassign.
  const mother = people.find(p => p.role === 'viewer') ?? people[0]

  const [fromPerson, setFromPerson] = useState(mother?.id ?? '')
  const [amount, setAmount] = useState('')
  const [currency, setCurrency] = useState<Currency>('SAR')
  const [rate, setRate] = useState('')
  const [date, setDate] = useState(today())
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const [clientUuid, setClientUuid] = useState(newClientUuid)

  const minor = toMinorUnits(amount)
  const fx = currency === 'EGP' ? 1 : parseRate(rate)
  const egp = minor && fx ? toEgp(minor, fx) : null

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setErr(null)
    if (!minor) return setErr('err_amount')
    if (!fx) return setErr('rm_err_rate')
    if (date > today()) return setErr('err_future')

    setBusy(true)
    try {
      await recordRemittance({
        familyId: family.id, fromPerson, amountOriginal: minor,
        currency, fxRate: fx, receivedOn: date, visitNote: note || null, clientUuid,
      })
      setDone(true)
      onSaved()
    } catch (e) {
      setErr((e as { message?: string }).message ?? 'err_load')
    } finally { setBusy(false) }
  }

  if (done) {
    return (
      <div className="card form">
        <div className="donemark">✓</div>
        <h2 style={{ textAlign: 'center', marginTop: 12 }}>{t('saved')}</h2>
        <button className="btn wide ghost" style={{ marginTop: 22 }}
                onClick={() => {
                  setDone(false); setAmount(''); setRate(''); setNote('')
                  setClientUuid(newClientUuid())
                }}>
          {t('add_another')}
        </button>
      </div>
    )
  }

  return (
    <form className="card form wide-form" onSubmit={submit}>
      <div className="cardhead"><h2>{t('rm_record')}</h2></div>
      <p className="sub">{t('rm_sub')}</p>

      <div className="grid2" style={{ marginTop: 18 }}>
        <div className="field">
          <label>{t('rm_from')}</label>
          <select className="input" value={fromPerson}
                  onChange={e => setFromPerson(e.target.value)}>
            {people.map(p => <option key={p.id} value={p.id}>{p.display_name}</option>)}
          </select>
        </div>
        <div className="field">
          <label>{t('f_date')}</label>
          <input className="input" type="date" value={date} max={today()}
                 onChange={e => setDate(e.target.value)} />
        </div>
      </div>

      <div className="grid3">
        <div className="field">
          <label>{t('rm_amount')}</label>
          <input className="input" inputMode="decimal" value={amount} autoFocus
                 onChange={e => setAmount(e.target.value)} placeholder="0.00" />
        </div>
        <div className="field">
          <label>{t('rm_currency')}</label>
          <select className="input" value={currency}
                  onChange={e => {
                    const c = e.target.value as Currency
                    setCurrency(c)
                    if (c === 'EGP') setRate('1')
                  }}>
            {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div className="field">
          <label>{t('rm_rate')}</label>
          <input className="input" inputMode="decimal" value={currency === 'EGP' ? '1' : rate}
                 disabled={currency === 'EGP'}
                 onChange={e => setRate(e.target.value)} placeholder="12.90" />
        </div>
      </div>
      <p className="hint">{t('rm_rate_note')}</p>

      <div className="field" style={{ marginTop: 16 }}>
        <label>{t('rm_note')} <span className="opt">· {t('f_optional')}</span></label>
        <input className="input" value={note} placeholder={t('rm_note_eg')}
               onChange={e => setNote(e.target.value)} />
      </div>

      {/* Shown live so he can catch a mistyped rate before it is a journal.
          Computed again in SQL on submit — this is a preview, not the answer. */}
      <div className="split">
        <div className="splitline strong">
          <span>{t('rm_comes_to')}</span>
          <span className="amt plus">{egp == null ? '—' : money(egp, lang)}</span>
        </div>
      </div>

      {err && <p className="errmsg">{/^[a-z_]+$/.test(err) ? t(err as any) : err}</p>}

      <button className="btn wide" style={{ marginTop: 20 }} disabled={busy}>
        {busy ? t('saving') : t('rm_submit')}
      </button>
    </form>
  )
}

const fmtMinor = (n: number) =>
  new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(n / 100)
/** Rates carry up to six places, and trailing zeros say nothing. */
const fmtRate = (n: number) => String(Number(n))

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

export type { Remittance }
