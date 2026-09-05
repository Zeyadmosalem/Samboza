import { useMemo, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { useT, money } from '../lib/i18n'
import { useLoad } from '../lib/useLoad'
import { supabase, type Family, type Person } from '../lib/supabase'
import {
  SERIES, byCategory, byMonth, byPerson, lastMonths, reportRows,
} from '../lib/data'
import { Donut, Legend, MonthBars, PersonBars, TrendLine, step, useIsDark } from '../components/Charts'

interface Ctx { person: Person; family: Family; code: string }

/**
 * The four charts §5 asks for: income against expense by month, spending by
 * category, the trend, and what the family spends on each person.
 *
 * ONE query feeds all four. Fetching each chart separately is how a report
 * ends up with a bar chart and a donut that disagree, and a reader who cannot
 * tell which one is lying.
 *
 * A TABLE VIEW IS NOT OPTIONAL HERE. Three of the palette's light-mode slots
 * sit below 3:1 against a white card — the validator warns, and the rule is
 * that a warning obliges either visible labels or a table. This ships both,
 * which also happens to be the only way to read a seven-category breakdown
 * when the donut can only honestly show six.
 */
export default function Reports() {
  const { family } = useOutletContext<Ctx>()
  const { t, lang } = useT()
  const dark = useIsDark()
  const [months, setMonths] = useState(6)
  const [table, setTable] = useState(false)

  const load = useLoad(async () => {
    const [rows, people] = await Promise.all([
      reportRows(family.id, months),
      supabase.from('people').select('id,display_name').eq('family_id', family.id)
        .then(r => { if (r.error) throw r.error; return r.data as { id: string; display_name: string }[] }),
    ])
    return { rows, people }
  }, [family.id, months])

  const d = load.data
  const period = useMemo(() => lastMonths(months), [months])
  const fmt = (n: number) => money(n, lang)
  const shortMonth = (iso: string) => {
    const [y, m] = iso.split('-').map(Number)
    return new Intl.DateTimeFormat(lang === 'ar' ? 'ar-EG-u-nu-latn' : 'en-GB',
      { month: 'short' }).format(new Date(y, m - 1, 1))
  }

  const monthly = d ? byMonth(d.rows, period) : []
  const cats = d
    ? byCategory(d.rows, lang, t('rp_rest'))
    : { slices: [], all: [], total: 0 }
  const names = new Map((d?.people ?? []).map(p => [p.id, p.display_name]))
  const perPerson = d ? byPerson(d.rows, names, t('rp_unattributed')) : []
  const net = monthly.map(m => m.income - m.expense)
  const empty = !!d && !d.rows.length

  return (
    <div className="stack">
      <div className="card filters">
        <div className="field">
          <label>{t('rp_period')}</label>
          <div className="seg">
            {[3, 6, 12].map(n => (
              <button key={n} className={'segbtn' + (months === n ? ' on' : '')}
                      onClick={() => setMonths(n)}>{n}</button>
            ))}
          </div>
        </div>
        <div className="field">
          <label>{t('rp_view')}</label>
          <div className="seg">
            <button className={'segbtn' + (!table ? ' on' : '')} onClick={() => setTable(false)}>
              {t('rp_charts')}
            </button>
            <button className={'segbtn' + (table ? ' on' : '')} onClick={() => setTable(true)}>
              {t('rp_table')}
            </button>
          </div>
        </div>
      </div>

      {load.loading && <div className="card"><p className="sub">{t('loading')}</p></div>}
      {load.failed && (
        <div className="card">
          <p className="sub">
            {t('err_load')} <button className="linkbtn" onClick={load.reload}>{t('retry')}</button>
          </p>
        </div>
      )}
      {empty && <div className="card"><p className="sub">{t('rp_empty')}</p></div>}

      {!!d && !empty && (table ? (
        <TableView monthly={monthly} cats={cats.all} perPerson={perPerson}
                   period={period} shortMonth={shortMonth} fmt={fmt} />
      ) : (
        <>
          <div className="card">
            <div className="cardhead"><h2>{t('rp_in_out')}</h2></div>
            <p className="sub">{t('rp_in_out_sub')}</p>
            <MonthBars
              data={monthly}
              labels={period.map(shortMonth)}
              fmt={fmt}
              series={{
                income: step('#1baf7a', dark), expense: step('#e34948', dark),
                incomeLabel: t('rp_income'), expenseLabel: t('rp_expense'),
              }}
            />
          </div>

          <div className="card">
            <div className="cardhead"><h2>{t('rp_trend')}</h2></div>
            <p className="sub">{t('rp_trend_sub')}</p>
            <TrendLine data={net} labels={period.map(shortMonth)} fmt={fmt}
                       colour={step(SERIES[0], dark)} label={t('rp_net')} />
          </div>

          <div className="card">
            <div className="cardhead">
              <h2>{t('rp_by_category')}</h2>
              <span className="sub">{fmt(cats.total)}</span>
            </div>
            <p className="sub">{cats.all.length > cats.slices.length ? t('rp_donut_capped') : t('rp_by_category_sub')}</p>
            <div className="donutrow">
              <Donut slices={cats.slices.map(s => ({ ...s, colour: step(s.colour, dark) }))}
                     total={cats.total} fmt={fmt} />
              {/* Direct labels beside the ring rather than inside it: a value
                  crammed into a thin slice gets clipped, and three of these
                  hues need a visible label to satisfy the contrast rule. */}
              <div className="donutkeys">
                {cats.slices.map(s => (
                  <div className="donutkey" key={s.key}>
                    <span className="swatch" style={{ background: step(s.colour, dark) }} />
                    <span className="l">{s.label}</span>
                    <span className="v">{fmt(s.amount)}</span>
                    <span className="p">{Math.round((s.amount / cats.total) * 100)}%</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="card">
            <div className="cardhead"><h2>{t('rp_by_person')}</h2></div>
            <p className="sub">{t('rp_by_person_sub')}</p>
            {perPerson.length
              ? <PersonBars rows={perPerson.map(r => ({ ...r, colour: step(SERIES[0], dark) }))} fmt={fmt} />
              : <p className="sub" style={{ padding: '14px 0' }}>{t('rp_nobody')}</p>}
          </div>
        </>
      ))}
    </div>
  )
}

/** The same numbers, readable without seeing colour at all. */
function TableView({ monthly, cats, perPerson, period, shortMonth, fmt }: {
  monthly: { month: string; income: number; expense: number }[]
  cats: { key: string; label: string; amount: number }[]
  perPerson: { key: string; label: string; amount: number }[]
  period: string[]
  shortMonth: (iso: string) => string
  fmt: (n: number) => string
}) {
  const { t } = useT()
  return (
    <div className="stack">
      <div className="card">
        <div className="cardhead"><h2>{t('rp_in_out')}</h2></div>
        <div className="tablewrap">
          <table className="datatable">
            <thead>
              <tr>
                <th>{t('rp_month')}</th>
                <th className="n">{t('rp_income')}</th>
                <th className="n">{t('rp_expense')}</th>
                <th className="n">{t('rp_net')}</th>
              </tr>
            </thead>
            <tbody>
              {monthly.map((m, i) => (
                <tr key={m.month}>
                  <td>{shortMonth(period[i])}</td>
                  <td className="n">{fmt(m.income)}</td>
                  <td className="n">{fmt(m.expense)}</td>
                  <td className="n">{fmt(m.income - m.expense)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <div className="cardhead"><h2>{t('rp_by_category')}</h2></div>
        <div className="tablewrap">
          <table className="datatable">
            <thead>
              <tr><th>{t('f_category')}</th><th className="n">{t('f_amount')}</th></tr>
            </thead>
            <tbody>
              {cats.map(c => (
                <tr key={c.key}><td>{c.label}</td><td className="n">{fmt(c.amount)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <div className="cardhead"><h2>{t('rp_by_person')}</h2></div>
        <div className="tablewrap">
          <table className="datatable">
            <thead>
              <tr><th>{t('h_person')}</th><th className="n">{t('f_amount')}</th></tr>
            </thead>
            <tbody>
              {perPerson.map(p => (
                <tr key={p.key}><td>{p.label}</td><td className="n">{fmt(p.amount)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

export { Legend }
