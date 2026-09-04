import { Link, useOutletContext } from 'react-router-dom'
import { useT, money } from '../lib/i18n'
import { useLoad } from '../lib/useLoad'
import type { Family, Person, Role } from '../lib/supabase'
import {
  balances, carDays, categories, fmtDay, ledgerFeed, memberExpenses,
  allowanceRate, monthStart, systemBalance,
  type CarDay, type Category, type LedgerRow, type MemberExpense,
} from '../lib/data'

interface Ctx { person: Person; family: Family; code: string }

/**
 * Four different dashboards behind one route.
 *
 * Not a single screen with things hidden: the driver and the admin do not
 * want the same numbers made smaller, they want different numbers. Hiding
 * would also imply the data is there and merely not shown — for Joe it is
 * genuinely not there, because `entries` returns him nothing.
 */
export default function Dashboard() {
  const { person } = useOutletContext<Ctx>()
  const role = person.role as Role
  if (role === 'driver') return <DriverDashboard />
  if (role === 'member') return <MemberDashboard />
  return <FamilyDashboard />
}

/* ------------------------------------------------------------- pieces --- */

/**
 * `pending` is not decoration. Until the query returns, `sum([])` is 0 and a
 * KPI would read "Cash in hand: EGP 0" — a specific, wrong, believable claim
 * about the family's money. A dash says nothing, which is the truth so far.
 */
function Kpi({ label, value, tone, note, pending }: {
  label: string; value: string; tone?: 'in' | 'out' | 'warn'
  note?: string; pending?: boolean
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

function Panel({ title, action, children }: {
  title: string; action?: React.ReactNode; children: React.ReactNode
}) {
  return (
    <div className="card">
      <div className="cardhead">
        <h2>{title}</h2>
        {action}
      </div>
      {children}
    </div>
  )
}

function State({ loading, failed, empty, onRetry }: {
  loading: boolean; failed: boolean; empty: boolean; onRetry: () => void
}) {
  const { t } = useT()
  if (loading) return <p className="sub" style={{ padding: '14px 0' }}>{t('loading')}</p>
  if (failed) return (
    <p className="sub" style={{ padding: '14px 0' }}>
      {t('err_load')}{' '}
      <button className="linkbtn" onClick={onRetry}>{t('retry')}</button>
    </p>
  )
  if (empty) return <p className="sub" style={{ padding: '14px 0' }}>{t('nothing_yet')}</p>
  return null
}

/* ------------------------------------------------- admin and the viewer -- */

function FamilyDashboard() {
  const { family } = useOutletContext<Ctx>()
  const { t, lang } = useT()

  const load = useLoad(async () => {
    const [bal, month, recent, pending] = await Promise.all([
      balances(family.id),
      ledgerFeed({ familyId: family.id, from: monthStart(), limit: 500 }),
      ledgerFeed({ familyId: family.id, limit: 8 }),
      memberExpenses({ familyId: family.id, status: 'pending', limit: 100 }),
    ])
    return { bal, month, recent, pending }
  }, [family.id])

  const d = load.data
  const pending = load.loading || load.failed
  // signed_amount is already "money in is positive": the view flips the sign
  // on income and expense accounts so a screen never repeats that reasoning.
  const income = d ? sum(d.month.filter(r => r.account_kind === 'income').map(r => r.signed_amount)) : 0
  const spend = d ? -sum(d.month.filter(r => r.account_kind === 'expense').map(r => r.signed_amount)) : 0

  return (
    <div className="stack">
      <div className="kpis">
        <Kpi label={t('kpi_cash')} pending={pending}
             value={money(d ? systemBalance(d.bal, 'cash') : 0, lang)} />
        <Kpi label={t('kpi_income_month')} pending={pending}
             value={money(income, lang)} tone="in" />
        <Kpi label={t('kpi_spend_month')} pending={pending}
             value={money(spend, lang)} tone="out" />
        <Kpi label={t('kpi_with_driver')} pending={pending}
             value={money(d ? systemBalance(d.bal, 'due_from_driver') : 0, lang)}
             note={t('kpi_with_driver_note')} />
      </div>

      {!pending && !!d?.pending.length && (
        <Link to="/approvals" className="notice">
          {t('kpi_pending')} · {d.pending.length}
        </Link>
      )}

      <Panel
        title={t('recent_activity')}
        action={<Link className="linkbtn" to="/history">{t('see_all')}</Link>}
      >
        <State loading={load.loading} failed={load.failed}
               empty={!!d && !d.recent.length} onRetry={load.reload} />
        <div className="rows">
          {d?.recent.map(r => <LedgerLine key={r.entry_id} row={r} lang={lang} />)}
        </div>
      </Panel>
    </div>
  )
}

function LedgerLine({ row, lang }: { row: LedgerRow; lang: 'en' | 'ar' }) {
  const { t } = useT()
  const name = (lang === 'ar' ? row.category_ar : row.category_en) ?? row.memo ?? '—'
  return (
    <div className="row">
      <div className="dot" style={{ background: row.category_colour ?? 'var(--neutral)' }} />
      <div className="rowmain">
        <div className="rowtitle">
          {name}
          {row.reverses && <span className="badge warn">{t('reversal')}</span>}
        </div>
        <div className="rowsub">
          {fmtDay(row.occurred_on, lang)}
          {row.person_name && <> · {row.person_name}</>}
          {row.memo && row.category_en && <> · {row.memo}</>}
        </div>
      </div>
      <div className={'amt ' + (row.signed_amount >= 0 ? 'plus' : 'minus')}>
        {money(row.signed_amount, lang)}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------- a member -- */

function MemberDashboard() {
  const { person, family } = useOutletContext<Ctx>()
  const { t, lang } = useT()

  const load = useLoad(async () => {
    const [rate, month, recent, cats] = await Promise.all([
      allowanceRate(person.id),
      memberExpenses({ familyId: family.id, personId: person.id, from: monthStart(), limit: 300 }),
      memberExpenses({ familyId: family.id, personId: person.id, limit: 8 }),
      categories(family.id),
    ])
    return { rate, month, recent, cats }
  }, [family.id, person.id])

  const d = load.data
  const waiting = load.loading || load.failed
  const spent = d ? sum(d.month.filter(r => r.status === 'approved').map(r => r.amount_egp)) : 0
  const pending = d ? d.month.filter(r => r.status === 'pending').length : 0

  return (
    <div className="stack">
      <div className="kpis">
        <Kpi label={t('kpi_allowance')} pending={waiting}
             value={d?.rate != null ? money(d.rate, lang) : '—'} />
        <Kpi label={t('kpi_spent_month')} pending={waiting}
             value={money(spent, lang)} tone="out" />
        <Kpi label={t('kpi_pending')} pending={waiting}
             value={String(pending)} tone={pending ? 'warn' : undefined} />
      </div>

      <Panel
        title={t('your_submissions')}
        action={<Link className="linkbtn" to="/add">{t('nav_add')}</Link>}
      >
        <State loading={load.loading} failed={load.failed}
               empty={!!d && !d.recent.length} onRetry={load.reload} />
        <div className="rows">
          {d?.recent.map(r => (
            <SubmissionLine key={r.id} row={r} cats={d.cats} lang={lang} />
          ))}
        </div>
      </Panel>
    </div>
  )
}

export function SubmissionLine({ row, cats, lang, who }: {
  row: MemberExpense; cats: Category[]; lang: 'en' | 'ar'; who?: string
}) {
  const { t } = useT()
  const cat = cats.find(c => c.id === row.category_id)
  return (
    <div className="row">
      <div className="dot" style={{ background: cat?.colour ?? 'var(--neutral)' }} />
      <div className="rowmain">
        <div className="rowtitle">
          {(lang === 'ar' ? cat?.name_ar : cat?.name_en) ?? '—'}
          <span className={'badge ' + row.status}>{t(`st_${row.status}` as any)}</span>
        </div>
        <div className="rowsub">
          {fmtDay(row.occurred_on, lang)}
          {who && <> · {who}</>}
          {row.description && <> · {row.description}</>}
          {row.status === 'rejected' && row.reason && <> · {row.reason}</>}
        </div>
      </div>
      <div className="amt minus">{money(-row.amount_egp, lang)}</div>
    </div>
  )
}

/* ------------------------------------------------------------- the driver */

function DriverDashboard() {
  const { person, family } = useOutletContext<Ctx>()
  const { t, lang } = useT()

  const load = useLoad(async () => {
    const [month, recent] = await Promise.all([
      carDays({ familyId: family.id, from: monthStart(), limit: 200 }),
      carDays({ familyId: family.id, limit: 8 }),
    ])
    return { month, recent }
  }, [family.id, person.id])

  const d = load.data
  const pending = load.loading || load.failed
  const worked = d ? d.month.filter(x => x.worked).length : 0
  const net = d ? sum(d.month.map(x => x.net_egp)) : 0
  const share = d ? sum(d.month.map(x => x.driver_egp)) : 0
  // Everything he has recorded and not yet handed to Abdo. The family's third
  // of it, which is the part that is owed — his own share is already his.
  const owed = d ? sum(d.month.filter(x => x.status === 'recorded').map(x => x.family_egp)) : 0

  return (
    <div className="stack">
      <div className="kpis">
        <Kpi label={t('kpi_days_month')} pending={pending} value={String(worked)} />
        <Kpi label={t('kpi_net_month')} pending={pending}
             value={money(net, lang)} tone={net < 0 ? 'out' : 'in'} />
        <Kpi label={t('kpi_your_share')} pending={pending} value={money(share, lang)} />
        <Kpi label={t('kpi_not_handed')} pending={pending}
             value={money(owed, lang)} note={t('kpi_with_driver_note')} />
      </div>

      {!pending && net < 0 && <div className="notice flat">{t('net_negative_note')}</div>}

      <Panel
        title={t('your_days')}
        action={<Link className="linkbtn" to="/carday">{t('nav_carday')}</Link>}
      >
        <State loading={load.loading} failed={load.failed}
               empty={!!d && !d.recent.length} onRetry={load.reload} />
        <div className="rows">
          {d?.recent.map(x => <CarLine key={x.id} row={x} lang={lang} />)}
        </div>
      </Panel>
    </div>
  )
}

export function CarLine({ row, lang }: { row: CarDay; lang: 'en' | 'ar' }) {
  const { t } = useT()
  const costs = row.direct_egp + row.indirect_egp
  return (
    <div className="row">
      <div className="dot" style={{ background: row.worked ? 'var(--trend)' : 'var(--neutral)' }} />
      <div className="rowmain">
        <div className="rowtitle">
          {row.worked ? t('nav_car') : t('day_off')}
          <span className={'badge ' + row.status}>{t(`st_${row.status}` as any)}</span>
        </div>
        <div className="rowsub">
          {fmtDay(row.drive_date, lang)}
          {row.worked && <> · {money(row.gross_egp, lang)} − {money(costs, lang)}</>}
        </div>
      </div>
      <div className={'amt ' + (row.net_egp >= 0 ? 'plus' : 'minus')}>
        {money(row.net_egp, lang)}
      </div>
    </div>
  )
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)
