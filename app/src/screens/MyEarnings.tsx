import { useOutletContext } from 'react-router-dom'
import { useT, money } from '../lib/i18n'
import { useLoad } from '../lib/useLoad'
import type { Family, Person } from '../lib/supabase'
import { carDays, carExpensesFor, fmtDay, monthStart } from '../lib/data'

interface Ctx { person: Person; family: Family; code: string }

/**
 * Joe's own record.
 *
 * He cannot read `entries`, `accounts` or the family ledger — the policies
 * return him nothing — so every figure here is computed from his own
 * `car_days`, which is exactly the data he put there. That is not a
 * workaround: the family's cash position is not his business, and what he
 * earned and what he still owes are.
 */
export default function MyEarnings() {
  const { person, family } = useOutletContext<Ctx>()
  const { t, lang } = useT()

  const load = useLoad(async () => {
    const days = await carDays({ familyId: family.id, limit: 90 })
    const costs = await carExpensesFor(days.map(d => d.id))
    return { days, costs }
  }, [family.id, person.id])

  const d = load.data
  const pending = load.loading || load.failed
  const month = d?.days.filter(x => x.drive_date >= monthStart()) ?? []
  const worked = month.filter(x => x.worked).length
  const mine = month.reduce((a, x) => a + x.driver_egp, 0)
  const net = month.reduce((a, x) => a + x.net_egp, 0)
  // Only what he has recorded and not handed over. A settled day is finished.
  // D14: he hands Abdo the family's share AND Marwa's, so both are counted.
  const owed = (d?.days ?? [])
    .filter(x => x.status === 'recorded')
    .reduce((a, x) => a + x.family_egp + x.marwa_egp, 0)
  // D13: days he is out of pocket on, waiting for Abdo to settle.
  const waiting = (d?.days ?? []).filter(x => x.net_egp < 0 && !x.loss_journal_id)

  return (
    <div className="stack">
      <div className="kpis">
        <Kpi label={t('kpi_your_share')} pending={pending} value={money(mine, lang)} tone="in" />
        <Kpi label={t('kpi_days_month')} pending={pending} value={String(worked)} />
        <Kpi label={t('kpi_net_month')} pending={pending} value={money(net, lang)}
             tone={net < 0 ? 'out' : 'in'} />
        <Kpi label={t('me_owed')} pending={pending} value={money(owed, lang)}
             note={t('me_owed_note')} />
      </div>

      {!pending && !!waiting.length && (
        <div className="notice flat">
          {t('me_waiting_settle')} · {money(waiting.reduce((a, x) => a + -x.net_egp, 0), lang)}
        </div>
      )}

      <div className="card">
        <div className="cardhead"><h2>{t('your_days')}</h2></div>

        {load.loading && <p className="sub" style={{ padding: '14px 0' }}>{t('loading')}</p>}
        {load.failed && (
          <p className="sub" style={{ padding: '14px 0' }}>
            {t('err_load')} <button className="linkbtn" onClick={load.reload}>{t('retry')}</button>
          </p>
        )}
        {!pending && !d?.days.length && (
          <p className="sub" style={{ padding: '14px 0' }}>{t('nothing_yet')}</p>
        )}

        <div className="rows">
          {d?.days.map(x => {
            const mineCosts = d.costs.filter(c => c.car_day_id === x.id)
            return (
              <div className="row" key={x.id}>
                <div className="dot" style={{ background: x.worked ? 'var(--trend)' : 'var(--neutral)' }} />
                <div className="rowmain">
                  <div className="rowtitle">
                    {fmtDay(x.drive_date, lang)}
                    <span className={'badge ' + x.status}>{t(`st_${x.status}` as any)}</span>
                  </div>
                  <div className="rowsub">
                    {x.worked
                      ? <>{money(x.gross_egp, lang)} − {money(x.direct_egp + x.indirect_egp, lang)}
                          {!!mineCosts.length && <> · {mineCosts.map(c => t(`cost_${c.label}` as any)).join(', ')}</>}</>
                      : t('day_off')}
                  </div>
                </div>
                <div className={'amt ' + (x.driver_egp >= 0 ? 'plus' : 'minus')}>
                  {money(x.driver_egp, lang)}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
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
