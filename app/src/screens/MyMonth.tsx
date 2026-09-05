import { useMemo, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { useT, money } from '../lib/i18n'
import { useLoad } from '../lib/useLoad'
import type { Family, Person } from '../lib/supabase'
import {
  monthLabel, myRemittances, personalEntries, personalMonths, SERIES,
  type Currency,
} from '../lib/data'
import { MonthBars } from '../components/Charts'

interface Ctx { person: Person; family: Family; code: string }

/**
 * HER MONTH — §3.6, the reviewing half of her own book.
 *
 * Every figure is kept in the currency it was in. There is no total across
 * currencies anywhere on this screen, and that is deliberate: adding SAR to
 * EGP needs a rate, this book has none, and the rates that do exist belong to
 * remittances — a different transaction, on a different day, at a rate the
 * accountant set for the family's purposes. A blended figure would not be
 * slightly wrong; it would not be a quantity of anything.
 *
 * What she sent home is shown beside her months rather than inside them. It
 * is the one event that appears in both books — hers as the largest outgoing
 * of the month, the family's as income — and it is read here from the family
 * side, which she is allowed to see and not allowed to change.
 */
export default function MyMonth() {
  const { person, family } = useOutletContext<Ctx>()
  const { t, lang } = useT()

  const load = useLoad(async () => {
    const [rows, sent] = await Promise.all([
      personalEntries(person.id, { limit: 500 }),
      myRemittances(family.id, person.id),
    ])
    return { months: personalMonths(rows), sent }
  }, [person.id, family.id])

  const months = load.data?.months ?? []

  /** Which currency the chart is drawn in. One at a time, always named. */
  const currencies = useMemo(() => {
    const seen = new Set<Currency>()
    for (const m of months) for (const b of m.by) seen.add(b.currency)
    return [...seen]
  }, [months])

  const [cur, setCur] = useState<Currency | null>(null)
  const shown = cur && currencies.includes(cur) ? cur : currencies[0] ?? null

  const chart = useMemo(() => {
    if (!shown) return []
    return months
      .slice(0, 12)
      .reverse()
      .map(m => {
        const b = m.by.find(x => x.currency === shown)
        return { month: m.month, income: b?.in ?? 0, expense: b?.out ?? 0 }
      })
  }, [months, shown])

  if (load.loading) return <div className="stack"><p className="sub">{t('loading')}</p></div>
  if (load.failed) {
    return (
      <div className="stack">
        <p className="sub">
          {t('err_load')} <button className="linkbtn" onClick={load.reload}>{t('retry')}</button>
        </p>
      </div>
    )
  }

  return (
    <div className="stack">
      {!months.length && (
        <div className="card">
          <p className="sub" style={{ padding: '14px 0' }}>{t('pb_nothing')}</p>
        </div>
      )}

      {!!shown && (
        <div className="card">
          <div className="cardhead">
            <div>
              <h2>{t('pb_by_month')}</h2>
              <p className="sub">{t('pb_one_currency')}</p>
            </div>
            {currencies.length > 1 && (
              <div className="seg" role="group">
                {currencies.map(c => (
                  <button key={c} type="button"
                          className={'segbtn' + (c === shown ? ' on' : '')}
                          onClick={() => setCur(c)}>{c}</button>
                ))}
              </div>
            )}
          </div>

          <MonthBars
            data={chart}
            labels={chart.map(d => monthLabel(d.month, lang))}
            fmt={n => money(n, lang, shown)}
            series={{
              income: SERIES[0], expense: SERIES[1],
              incomeLabel: t('pb_in'), expenseLabel: t('pb_out'),
            }}
          />
        </div>
      )}

      {/* The table is obliged rather than offered: it is the only place every
          currency is legible at once, and the chart can only ever show one. */}
      {!!months.length && (
        <div className="card">
          <div className="cardhead"><h2>{t('pb_every_month')}</h2></div>
          <div className="rows">
            {months.map(m => (
              <div className="row" key={m.month}>
                <div className="rowmain">
                  <div className="rowtitle">{monthLabel(m.month, lang)}</div>
                  <div className="rowsub">
                    {m.by.map(b => (
                      <span key={b.currency} style={{ marginInlineEnd: 12 }}>
                        {b.currency} · {t('pb_out')} {money(b.out, lang, b.currency)}
                        {b.in ? ` · ${t('pb_in')} ${money(b.in, lang, b.currency)}` : ''}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="card">
        <div className="cardhead">
          <div>
            <h2>{t('pb_sent_home')}</h2>
            <p className="sub">{t('pb_sent_home_note')}</p>
          </div>
        </div>
        {!load.data?.sent.length && (
          <p className="sub" style={{ padding: '14px 0' }}>{t('pb_none_sent')}</p>
        )}
        <div className="rows">
          {load.data?.sent.map(r => (
            <div className="row" key={r.id}>
              <div className="rowmain">
                <div className="rowtitle">{monthLabel(r.received_on.slice(0, 7) + '-01', lang)}</div>
                <div className="rowsub">
                  {money(r.amount_original, lang, r.currency)} · {t('rm_rate')} {r.fx_rate}
                  {r.visit_note ? ' · ' + r.visit_note : ''}
                </div>
              </div>
              <div className="amt">{money(r.amount_egp, lang)}</div>
            </div>
          ))}
        </div>
      </div>

      <p className="hint">{t('pb_private_note')}</p>
    </div>
  )
}
