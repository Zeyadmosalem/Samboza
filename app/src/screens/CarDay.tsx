import { useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { useT, money } from '../lib/i18n'
import type { Family, Person } from '../lib/supabase'
import {
  COST_LABELS, SUGGESTED_CLASS, newClientUuid, recordCarDay, splitPreview,
  toPiastres, today, type CostClass, type CostLabel,
} from '../lib/data'

interface Ctx { person: Person; family: Family; code: string }

interface Draft {
  key: number
  label: CostLabel
  cls: CostClass
  amount: string
  note: string
}

/**
 * Joe's screen. He enters the takings and the costs; the app does the
 * arithmetic and the DATABASE does the arithmetic that counts.
 *
 * The split shown here is a preview computed in `splitPreview`, and
 * `record_car_day` computes the stored one in SQL from the same lines. That
 * duplication is deliberate — he should see what he is about to submit — and
 * the rounding rule is copied exactly: Postgres rounds half away from zero,
 * JavaScript rounds half up. They only ever disagreed on negative halves, and
 * D13 took losses out of the split entirely, so the hazard is now gone rather
 * than merely handled. The rule stays copied because it costs nothing and the
 * next person to make a share negative should not have to rediscover it.
 */
export default function CarDay() {
  const { family } = useOutletContext<Ctx>()
  const { t, lang } = useT()

  const [date, setDate] = useState(today())
  const [worked, setWorked] = useState(true)
  const [gross, setGross] = useState('')
  const [costs, setCosts] = useState<Draft[]>([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [done, setDone] = useState<'sent' | 'queued' | null>(null)
  const [clientUuid, setClientUuid] = useState(newClientUuid)

  const grossP = toPiastres(gross) ?? 0
  const lines = costs
    .map(c => ({ ...c, p: toPiastres(c.amount) ?? 0 }))
    .filter(c => c.p > 0)
  const direct = lines.filter(c => c.cls === 'direct').reduce((a, c) => a + c.p, 0)
  const indirect = lines.filter(c => c.cls === 'indirect').reduce((a, c) => a + c.p, 0)
  // D2: every cost comes off BEFORE anyone's share.
  const net = grossP - direct - indirect
  // D13: a day that lost money is shared by nobody. Joe paid out of pocket
  // and Abdo makes him whole, so showing him a negative third would be
  // telling him he owes the family for a fine he already paid.
  const lost = net < 0
  const split = lost ? { driver: 0, family: 0, marwa: 0 } : splitPreview(net)

  function addCost() {
    const label: CostLabel = 'fuel'
    setCosts(c => [...c, { key: Date.now(), label, cls: SUGGESTED_CLASS[label], amount: '', note: '' }])
  }
  function update(key: number, patch: Partial<Draft>) {
    setCosts(c => c.map(x => (x.key === key ? { ...x, ...patch } : x)))
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setErr(null)
    if (date > today()) return setErr('err_future')
    if (worked && !grossP && !lines.length) return setErr('cd_err_empty')

    setBusy(true)
    try {
      setDone(await recordCarDay({
        familyId: family.id, driveDate: date, worked,
        gross: grossP,
        expenses: lines.map(c => ({
          label: c.label, class: c.cls, amount_egp: c.p, description: c.note || null,
        })),
        clientUuid,
      }))
    } catch (e) {
      const m = (e as { message?: string }).message ?? ''
      setErr(/duplicate key|one_live_per_day/i.test(m) ? 'cd_err_already' : m || 'err_load')
    } finally {
      setBusy(false)
    }
  }

  function again() {
    setDone(null); setGross(''); setCosts([]); setWorked(true)
    setDate(today())
    setClientUuid(newClientUuid())
  }

  if (done) {
    const queued = done === 'queued'
    return (
      <div className="card form">
        <div className={'donemark' + (queued ? ' waiting' : '')}>{queued ? '↑' : '✓'}</div>
        <h2 style={{ textAlign: 'center', marginTop: 12 }}>
          {queued ? t('ob_saved_here') : t('cd_saved')}
        </h2>
        {queued && <p className="sub" style={{ textAlign: 'center' }}>{t('ob_will_send')}</p>}
        <button className="btn wide ghost" style={{ marginTop: 22 }} onClick={again}>
          {t('cd_another')}
        </button>
      </div>
    )
  }

  return (
    <form className="card form wide-form" onSubmit={submit}>
      <div className="cardhead"><h2>{t('nav_carday')}</h2></div>
      <p className="sub">{t('cd_sub')}</p>

      <div className="grid2" style={{ marginTop: 18 }}>
        <div className="field">
          <label>{t('f_date')}</label>
          <input className="input" type="date" value={date} max={today()}
                 onChange={e => setDate(e.target.value)} />
        </div>
        <div className="field">
          <label>{t('cd_did_you_drive')}</label>
          <div className="seg">
            <button type="button" className={'segbtn' + (worked ? ' on' : '')}
                    onClick={() => setWorked(true)}>{t('cd_drove')}</button>
            <button type="button" className={'segbtn' + (!worked ? ' on' : '')}
                    onClick={() => { setWorked(false); setGross(''); setCosts([]) }}>
              {t('cd_day_off')}
            </button>
          </div>
        </div>
      </div>

      {/* A day off is a recorded row, not a missing one (D1) — so it submits,
          it just carries no money. */}
      {!worked && <p className="hint" style={{ marginTop: 14 }}>{t('cd_off_note')}</p>}

      {worked && (
        <>
          <div className="field" style={{ marginTop: 16 }}>
            <label>{`${t('cd_gross')} (${t('f_amount_unit')})`}</label>
            <input className="input" inputMode="decimal" value={gross} autoFocus
                   onChange={e => setGross(e.target.value)} placeholder="0.00" />
          </div>

          <div className="cardhead" style={{ marginTop: 22 }}>
            <h2>{t('cd_costs')}</h2>
            <button type="button" className="btn sm ghost" onClick={addCost}>
              {t('cd_add_cost')}
            </button>
          </div>
          <p className="sub">{t('cd_costs_note')}</p>

          {costs.map(c => (
            <div className="costrow" key={c.key}>
              <div className="field">
                <label>{t('cd_label')}</label>
                <select className="input" value={c.label}
                        onChange={e => {
                          const label = e.target.value as CostLabel
                          // The label suggests a class and never decides it —
                          // it re-suggests on change, and he can still override.
                          update(c.key, { label, cls: SUGGESTED_CLASS[label] })
                        }}>
                  {COST_LABELS.map(l => <option key={l} value={l}>{t(`cost_${l}` as any)}</option>)}
                </select>
              </div>
              <div className="field">
                <label>{t('cd_class')}</label>
                <div className="seg">
                  {(['direct', 'indirect'] as const).map(k => (
                    <button type="button" key={k}
                            className={'segbtn' + (c.cls === k ? ' on' : '')}
                            onClick={() => update(c.key, { cls: k })}>
                      {t(`cd_${k}` as any)}
                    </button>
                  ))}
                </div>
              </div>
              <div className="field">
                <label>{t('f_amount')}</label>
                <input className="input" inputMode="decimal" value={c.amount}
                       onChange={e => update(c.key, { amount: e.target.value })} placeholder="0.00" />
              </div>
              <div className="field">
                <label>{t('f_memo')} <span className="opt">· {t('f_optional')}</span></label>
                <input className="input" value={c.note}
                       onChange={e => update(c.key, { note: e.target.value })} />
              </div>
              <button type="button" className="linkbtn inline"
                      onClick={() => setCosts(x => x.filter(y => y.key !== c.key))}>
                {t('cd_remove')}
              </button>
            </div>
          ))}

          <div className="split">
            <Line label={t('cd_gross')} value={money(grossP, lang)} />
            <Line label={t('cd_direct_total')} value={money(-direct, lang)} muted />
            <Line label={t('cd_indirect_total')} value={money(-indirect, lang)} muted />
            <Line label={t('cd_net')} value={money(net, lang)} strong tone={lost ? 'out' : 'in'} />
            <hr />
            {lost ? (
              <p className="hint">{t('cd_loss_note')}</p>
            ) : (
              <>
                <Line label={t('cd_your_third')} value={money(split.driver, lang)} />
                <Line label={t('cd_family')} value={money(split.family, lang)} />
                <Line label={t('cd_marwa')} value={money(split.marwa, lang)} />
              </>
            )}
          </div>
        </>
      )}

      {err && <p className="errmsg">{/^[a-z_]+$/.test(err) ? t(err as any) : err}</p>}

      <button className="btn wide" style={{ marginTop: 20 }} disabled={busy}>
        {busy ? t('saving') : t('cd_submit')}
      </button>
    </form>
  )
}

function Line({ label, value, strong, muted, tone }: {
  label: string; value: string; strong?: boolean; muted?: boolean; tone?: 'in' | 'out'
}) {
  return (
    <div className={'splitline' + (strong ? ' strong' : '') + (muted ? ' muted' : '')}>
      <span>{label}</span>
      <span className={tone ? 'amt ' + (tone === 'in' ? 'plus' : 'minus') : 'amt'}>{value}</span>
    </div>
  )
}
