import { Link, useOutletContext } from 'react-router-dom'
import { useT, money } from '../lib/i18n'
import { useLoad } from '../lib/useLoad'
import type { Family, Person } from '../lib/supabase'
import { categories, memberBalances, memberExpenses } from '../lib/data'
import { SubmissionLine } from './Dashboard'

interface Ctx { person: Person; family: Family; code: string }

/**
 * A member's own book: what the family gave, what they spent of it, and what
 * is still waiting on Abdo.
 *
 * Pending is kept OUT of the balance and shown beside it. Subtracting it
 * would tell Zeyad he has less than he has, over a decision nobody has made
 * yet; ignoring it would let him spend the same money twice. The honest
 * answer is both numbers.
 */
export default function MySpending() {
  const { person, family } = useOutletContext<Ctx>()
  const { t, lang } = useT()

  const load = useLoad(async () => {
    const [bal, mine, cats] = await Promise.all([
      memberBalances(family.id),
      memberExpenses({ familyId: family.id, personId: person.id, limit: 50 }),
      categories(family.id),
    ])
    return { me: bal.find(b => b.person_id === person.id) ?? null, mine, cats }
  }, [family.id, person.id])

  const d = load.data
  const pending = load.loading || load.failed
  const me = d?.me

  return (
    <div className="stack">
      <div className="kpis">
        <Kpi label={t('ms_balance')} pending={pending}
             value={money(me?.balance ?? 0, lang)}
             tone={(me?.balance ?? 0) < 0 ? 'out' : 'in'} />
        <Kpi label={t('kpi_allowance')} pending={pending}
             value={me?.rate != null ? money(me.rate, lang) : '—'} />
        <Kpi label={t('ms_received')} pending={pending}
             value={money(me?.received ?? 0, lang)} />
        <Kpi label={t('ms_approved')} pending={pending}
             value={money(me?.approved ?? 0, lang)} tone="out" />
      </div>

      {!pending && !!me?.pending_count && (
        <div className="notice flat">
          {t('ms_waiting')} · {money(me.pending, lang)}
        </div>
      )}

      {!pending && (me?.balance ?? 0) < 0 && (
        <div className="notice warn">{t('ms_overspent')}</div>
      )}

      <div className="card">
        <div className="cardhead">
          <h2>{t('your_submissions')}</h2>
          <Link className="linkbtn" to="/add">{t('nav_add')}</Link>
        </div>

        {load.loading && <p className="sub" style={{ padding: '14px 0' }}>{t('loading')}</p>}
        {load.failed && (
          <p className="sub" style={{ padding: '14px 0' }}>
            {t('err_load')} <button className="linkbtn" onClick={load.reload}>{t('retry')}</button>
          </p>
        )}
        {!load.loading && !load.failed && !d?.mine.length && (
          <p className="sub" style={{ padding: '14px 0' }}>{t('nothing_yet')}</p>
        )}

        <div className="rows">
          {d?.mine.map(r => (
            <SubmissionLine key={r.id} row={r} cats={d.cats} lang={lang} />
          ))}
        </div>
      </div>
    </div>
  )
}

function Kpi({ label, value, tone, pending }: {
  label: string; value: string; tone?: 'in' | 'out'; pending?: boolean
}) {
  return (
    <div className="kpi">
      <div className="k">{label}</div>
      <div className={'v' + (pending ? ' muted' : tone ? ' ' + tone : '')}>
        {pending ? '—' : value}
      </div>
    </div>
  )
}
