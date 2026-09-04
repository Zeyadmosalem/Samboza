import { useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { useT, money } from '../lib/i18n'
import { useLoad } from '../lib/useLoad'
import { supabase, type Family, type Person, type Role } from '../lib/supabase'
import {
  carDays, categories, fmtDay, ledgerFeed, memberExpenses, monthStart, today,
  type CarDay, type Category, type LedgerRow, type MemberExpense,
} from '../lib/data'

interface Ctx { person: Person; family: Family; code: string }

/**
 * The family keeps money in three separate stores, on purpose:
 *
 *   the ledger        family money, double-entry, append-only
 *   member_expenses   what a member spent from the allowance already given
 *   car_days          what the car took and what it cost
 *
 * They are separate because merging them would double-count — the family
 * expensed the allowance when it was handed over, so a member's spending is
 * not a second family expense. But "what happened in August" is one question,
 * so they are stitched back together HERE, at read time, where nobody can
 * mistake the display for the accounting.
 *
 * What each person sees is decided by the database, not by this file. A member
 * running the same query gets their own submissions and an empty ledger,
 * because that is what the policies return.
 */

type Source = 'ledger' | 'submission' | 'car'

interface Item {
  key: string
  source: Source
  date: string
  title: string
  detail: string
  personId: string | null
  amount: number          // signed piastres; negative is money out
  status?: string
  colour?: string | null
  flag?: 'reversal'
}

/** Rows fetched per source, per page. */
const PAGE = 25

export default function History() {
  const { person, family } = useOutletContext<Ctx>()
  const { t, lang } = useT()
  const role = person.role as Role

  // A member has no ledger and no car days to read, so offering the filters
  // would be offering to show them nothing.
  const canSeeLedger = role === 'admin' || role === 'viewer'

  const [source, setSource] = useState<Source | 'all'>('all')
  const [personFilter, setPersonFilter] = useState('')
  const [from, setFrom] = useState(monthStart())
  const [to, setTo] = useState(today())
  const [page, setPage] = useState(1)

  const people = useLoad(async () => {
    const { data, error } = await supabase
      .from('people').select('id,display_name')
      .eq('family_id', family.id).eq('active', true).order('member_no')
    if (error) throw error
    return data as { id: string; display_name: string }[]
  }, [family.id])

  const load = useLoad(async () => {
    const limit = PAGE * page
    const q = { familyId: family.id, from, to, limit }
    const want = (s: Source) => source === 'all' || source === s

    const [cats, ledger, subs, days] = await Promise.all([
      categories(family.id),
      want('ledger') && canSeeLedger ? ledgerFeed({ ...q, personId: personFilter || null }) : [],
      want('submission') ? memberExpenses({ ...q, personId: personFilter || null }) : [],
      want('car') && canSeeLedger ? carDays(q) : [],
    ])
    return { cats, ledger, subs, days }
  }, [family.id, source, personFilter, from, to, page, canSeeLedger])

  const d = load.data
  const items = d ? merge(d, lang, personFilter, t) : []
  const shown = items.slice(0, PAGE * page)
  const more = items.length > shown.length ||
    // A full page from any one source means there is probably another.
    (!!d && [d.ledger.length, d.subs.length, d.days.length].some(n => n === PAGE * page))

  return (
    <div className="stack">
      <div className="card filters">
        <div className="field">
          <label>{t('h_source')}</label>
          <select className="input" value={source}
                  onChange={e => { setSource(e.target.value as any); setPage(1) }}>
            <option value="all">{t('h_all')}</option>
            {canSeeLedger && <option value="ledger">{t('src_ledger')}</option>}
            <option value="submission">{t('src_submission')}</option>
            {canSeeLedger && <option value="car">{t('src_car')}</option>}
          </select>
        </div>

        <div className="field">
          <label>{t('h_person')}</label>
          <select className="input" value={personFilter}
                  onChange={e => { setPersonFilter(e.target.value); setPage(1) }}>
            <option value="">{t('h_all')}</option>
            {(people.data ?? []).map(p => (
              <option key={p.id} value={p.id}>{p.display_name}</option>
            ))}
          </select>
        </div>

        <div className="field">
          <label>{t('h_from')}</label>
          <input className="input" type="date" value={from}
                 onChange={e => { setFrom(e.target.value); setPage(1) }} />
        </div>

        <div className="field">
          <label>{t('h_to')}</label>
          <input className="input" type="date" value={to} max={today()}
                 onChange={e => { setTo(e.target.value); setPage(1) }} />
        </div>
      </div>

      {!canSeeLedger && <div className="notice flat">{t('h_only_yours')}</div>}

      <div className="card">
        {load.loading && <p className="sub" style={{ padding: '14px 0' }}>{t('loading')}</p>}
        {load.failed && (
          <p className="sub" style={{ padding: '14px 0' }}>
            {t('err_load')}{' '}
            <button className="linkbtn" onClick={load.reload}>{t('retry')}</button>
          </p>
        )}
        {!load.loading && !load.failed && !shown.length && (
          <p className="sub" style={{ padding: '14px 0' }}>{t('h_empty')}</p>
        )}

        <div className="rows">
          {shown.map(it => (
            <div className="row" key={it.key}>
              <div className="dot" style={{ background: it.colour ?? 'var(--neutral)' }} />
              <div className="rowmain">
                <div className="rowtitle">
                  {it.title}
                  <span className={'badge src-' + it.source}>
                    {t(`src_${it.source === 'submission' ? 'submission' : it.source}` as any)}
                  </span>
                  {it.status && (
                    <span className={'badge ' + it.status}>{t(`st_${it.status}` as any)}</span>
                  )}
                  {it.flag && <span className="badge warn">{t('reversal')}</span>}
                </div>
                <div className="rowsub">{it.detail}</div>
              </div>
              <div className={'amt ' + (it.amount >= 0 ? 'plus' : 'minus')}>
                {money(it.amount, lang)}
              </div>
            </div>
          ))}
        </div>

        {more && !load.loading && (
          <button className="btn ghost sm" style={{ marginTop: 16 }}
                  onClick={() => setPage(p => p + 1)}>
            {t('load_more')}
          </button>
        )}
      </div>
    </div>
  )
}

/* ---------------------------------------------------------------- merge -- */

function merge(
  d: { cats: Category[]; ledger: LedgerRow[]; subs: MemberExpense[]; days: CarDay[] },
  lang: 'en' | 'ar',
  personFilter: string,
  t: (k: any) => string,
): Item[] {
  const catName = (id: string | null) => {
    const c = d.cats.find(x => x.id === id)
    return (lang === 'ar' ? c?.name_ar : c?.name_en) ?? null
  }
  const catColour = (id: string | null) => d.cats.find(x => x.id === id)?.colour ?? null

  const items: Item[] = [
    ...d.ledger.map((r): Item => ({
      key: 'l' + r.entry_id,
      source: 'ledger',
      date: r.occurred_on,
      title: (lang === 'ar' ? r.category_ar : r.category_en) ?? r.memo ?? '—',
      detail: [fmtDay(r.occurred_on, lang), r.person_name, r.category_en ? r.memo : null]
        .filter(Boolean).join(' · '),
      personId: r.person_id,
      amount: r.signed_amount,
      colour: r.category_colour,
      flag: r.reverses ? 'reversal' : undefined,
    })),

    ...d.subs.map((r): Item => ({
      key: 's' + r.id,
      source: 'submission',
      date: r.occurred_on,
      title: catName(r.category_id) ?? '—',
      detail: [fmtDay(r.occurred_on, lang), r.description,
               r.status === 'rejected' ? r.reason : null].filter(Boolean).join(' · '),
      personId: r.person_id,
      // A submission is money already out of the member's hands. Shown as
      // out, never added to the ledger's expense total — a different store.
      amount: -r.amount_egp,
      status: r.status,
      colour: catColour(r.category_id),
    })),

    // The person filter is applied server-side for the other two stores;
    // car_days keys off submitted_by, which is the driver on every row.
    ...d.days
      .filter(x => !personFilter || x.submitted_by === personFilter)
      .map((r): Item => ({
        key: 'c' + r.id,
        source: 'car',
        date: r.drive_date,
        title: r.worked ? t('nav_car') : t('day_off'),
        detail: [
          fmtDay(r.drive_date, lang),
          r.worked
            ? `${money(r.gross_egp, lang)} − ${money(r.direct_egp + r.indirect_egp, lang)}`
            : null,
        ].filter(Boolean).join(' · '),
        personId: r.submitted_by,
        amount: r.net_egp,
        status: r.status,
        colour: r.worked ? 'var(--trend)' : null,
      })),
  ]

  // Newest first, and a stable tiebreak so the order does not shuffle between
  // renders when several things happened on the same day.
  return items.sort((a, b) => b.date.localeCompare(a.date) || a.key.localeCompare(b.key))
}
