import { useState, type FormEvent } from 'react'
import { useOutletContext } from 'react-router-dom'
import { useT, money } from '../lib/i18n'
import { useLoad } from '../lib/useLoad'
import type { Family, Person } from '../lib/supabase'
import {
  CURRENCIES, PERSONAL_IN, PERSONAL_OUT, newClientUuid, personalEntries,
  recordPersonal, toPiastres, today, fmtDay, type Currency, type PersonalEntry,
} from '../lib/data'

interface Ctx { person: Person; family: Family; code: string }

/**
 * HER OWN BOOK — §3.6.
 *
 * Ghada is a viewer of the family's books: she sees every figure and changes
 * none of them. This is the other direction entirely, and the two must never
 * blur. Nothing recorded here reaches the family ledger, appears on Abdo's
 * dashboard, or is approved by anybody — the policy on the table means he
 * cannot read a row of it, and that is the feature rather than a side effect.
 *
 * She records daily and reviews monthly, so this screen is the recording half
 * and My Month is the reviewing half.
 */
export default function MyMoney() {
  const { person, family } = useOutletContext<Ctx>()
  const { t, lang } = useT()

  const load = useLoad(
    async () => personalEntries(person.id, { limit: 40 }),
    [person.id],
  )

  return (
    <div className="stack">
      <PersonalForm person={person} family={family} onSaved={load.reload} />

      <div className="card">
        <div className="cardhead">
          <h2>{t('pb_recent')}</h2>
        </div>

        {load.loading && <p className="sub" style={{ padding: '14px 0' }}>{t('loading')}</p>}
        {load.failed && (
          <p className="sub" style={{ padding: '14px 0' }}>
            {t('err_load')} <button className="linkbtn" onClick={load.reload}>{t('retry')}</button>
          </p>
        )}
        {!load.loading && !load.failed && !load.data?.length && (
          <p className="sub" style={{ padding: '14px 0' }}>{t('pb_nothing')}</p>
        )}

        <div className="rows">
          {load.data?.map(r => <PersonalLine key={r.id} row={r} lang={lang} />)}
        </div>
      </div>

      <p className="hint">{t('pb_private_note')}</p>
    </div>
  )
}

export function PersonalLine({ row, lang }: {
  row: PersonalEntry; lang: 'en' | 'ar'
}) {
  const { t } = useT()
  return (
    <div className="row">
      <div className="rowmain">
        <div className="rowtitle">{t(('cat_' + row.category) as never)}</div>
        <div className="rowsub">
          {fmtDay(row.occurred_on, lang)}
          {row.description ? ' · ' + row.description : ''}
        </div>
      </div>
      <div className={'amt ' + (row.direction === 'in' ? 'plus' : 'minus')}>
        {row.direction === 'in' ? '+' : '−'}{money(row.amount, lang, row.currency).replace('−', '')}
      </div>
    </div>
  )
}

function PersonalForm({ person, family, onSaved }: {
  person: Person; family: Family; onSaved: () => void
}) {
  const { t } = useT()
  const [direction, setDirection] = useState<'in' | 'out'>('out')
  const [category, setCategory] = useState<string>('p_food')
  const [amount, setAmount] = useState('')
  // She is paid in SAR and lives there; EGP is the exception in her book, not
  // the default. Guessing EGP would have her retyping the currency daily.
  const [currency, setCurrency] = useState<Currency>('SAR')
  const [occurredOn, setOccurredOn] = useState(today())
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<'sent' | 'queued' | null>(null)
  const [error, setError] = useState<string | null>(null)

  const list = direction === 'in' ? PERSONAL_IN : PERSONAL_OUT

  function switchDirection(d: 'in' | 'out') {
    setDirection(d)
    // The old category belongs to the other list; leaving it selected would
    // submit "salary" as an expense.
    setCategory(d === 'in' ? PERSONAL_IN[0] : PERSONAL_OUT[0])
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    const minor = toPiastres(amount)
    if (minor == null || minor <= 0) return setError('err_amount')
    setBusy(true)
    setError(null)
    try {
      const where = await recordPersonal({
        familyId: family.id,
        personId: person.id,
        direction,
        category,
        amount: minor,
        currency,
        occurredOn,
        description: description.trim() || null,
        clientUuid: newClientUuid(),
      })
      setMsg(where)
      setAmount('')
      setDescription('')
      if (where === 'sent') onSaved()
    } catch (e: unknown) {
      setError('pb_err_save')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card">
      <div className="cardhead"><h2>{t('pb_record')}</h2></div>

      <form onSubmit={onSubmit}>
        <div className="seg" role="group">
          <button type="button" className={'segbtn' + (direction === 'out' ? ' on' : '')}
                  onClick={() => switchDirection('out')}>{t('pb_out')}</button>
          <button type="button" className={'segbtn' + (direction === 'in' ? ' on' : '')}
                  onClick={() => switchDirection('in')}>{t('pb_in')}</button>
        </div>

        <div className="grid2">
          <div className="field">
            <label htmlFor="pb-amount">{t('pb_amount')}</label>
            <input id="pb-amount" className="input" inputMode="decimal" required
                   disabled={busy} value={amount}
                   onChange={e => { setAmount(e.target.value); setError(null); setMsg(null) }}
                   placeholder="0" />
          </div>
          <div className="field">
            <label htmlFor="pb-currency">{t('rm_currency')}</label>
            <select id="pb-currency" className="input" disabled={busy} value={currency}
                    onChange={e => setCurrency(e.target.value as Currency)}>
              {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </div>

        <div className="grid2">
          <div className="field">
            <label htmlFor="pb-cat">{t('pb_category')}</label>
            <select id="pb-cat" className="input" disabled={busy} value={category}
                    onChange={e => setCategory(e.target.value)}>
              {list.map(c => <option key={c} value={c}>{t(('cat_' + c) as never)}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="pb-date">{t('f_date')}</label>
            {/* max is her today, which after 0017 is Riyadh's rather than
                Cairo's — the database will refuse anything later, and being
                refused after typing is worse than not being offered it. */}
            <input id="pb-date" className="input" type="date" required disabled={busy}
                   max={today()} value={occurredOn}
                   onChange={e => setOccurredOn(e.target.value)} />
          </div>
        </div>

        <div className="field">
          <label htmlFor="pb-desc">{t('pb_note')} <span className="sub">{t('f_optional')}</span></label>
          <input id="pb-desc" className="input" disabled={busy} value={description}
                 onChange={e => setDescription(e.target.value)} />
        </div>

        {error && <div className="errmsg" role="alert">{t(error as never)}</div>}
        {msg === 'sent' && <div className="notice flat">{t('saved')}</div>}
        {msg === 'queued' && (
          <div className="notice warn">{t('ob_saved_here')} · {t('ob_will_send')}</div>
        )}

        <button className="btn wide" type="submit" disabled={busy} style={{ marginTop: 16 }}>
          {busy ? t('saving') : t('pb_save')}
        </button>
      </form>
    </div>
  )
}
