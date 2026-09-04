import { useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { useT, money } from '../lib/i18n'
import { useLoad } from '../lib/useLoad'
import type { Family, Person, Role } from '../lib/supabase'
import {
  HANDOVER_ALARM_DAYS, HANDOVER_NUDGE_DAYS, balances, carDays, carExpensesFor,
  categories, confirmHandover, daysSince, fmtDay, handovers, monthStart,
  newClientUuid, settleCarLoss, systemBalance, toPiastres, today, voidCarDay,
  type CarDay,
} from '../lib/data'

interface Ctx { person: Person; family: Family; code: string }

/**
 * Abdo's side of the car. Ghada reads the same screen without the buttons.
 *
 * The number that matters is `due_from_driver`: what Joe has recorded and not
 * yet handed over. It is a real receivable posted the day each fare is
 * earned, not a figure this screen adds up — which is the whole point of
 * 0012, because a total computed on screen cannot be reconciled against
 * anything.
 */
export default function Car() {
  const { person, family } = useOutletContext<Ctx>()
  const { t, lang } = useT()
  const isAdmin = (person.role as Role) === 'admin'

  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [counted, setCounted] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [voiding, setVoiding] = useState<string | null>(null)
  const [reason, setReason] = useState('')

  const load = useLoad(async () => {
    // 60 rows: the queue is expected to hold up to a month of daily records,
    // and asking for the whole table every time the screen opens is how a
    // free-tier database gets slow for no reason.
    const days = await carDays({ familyId: family.id, limit: 60 })
    const [bal, hos, costs, cats] = await Promise.all([
      balances(family.id),
      handovers(family.id),
      carExpensesFor(days.map(d => d.id)),
      categories(family.id),
    ])
    return { days, bal, hos, costs, cats }
  }, [family.id])

  const d = load.data
  const pending = load.loading || load.failed
  // Two different queues. Days that earned money are waiting to be HANDED
  // OVER; days that lost money are waiting for Abdo to SETTLE them, and
  // mixing them into one list would ask him to tick a day that owes nothing.
  const outstanding = d?.days.filter(
    x => x.status === 'recorded' && x.family_egp + x.marwa_egp > 0) ?? []
  const losses = d?.days.filter(x => x.net_egp < 0 && !x.loss_journal_id) ?? []
  const monthDays = d?.days.filter(x => x.drive_date >= monthStart()) ?? []
  const held = d ? systemBalance(d.bal, 'due_from_driver') : 0
  const marwaOwed = d ? -systemBalance(d.bal, 'car_share_payable') : 0

  // The nudge. Abdo settles with Joe every ten days or so; the queue copes
  // with a month, and past that it is worth saying so plainly.
  const oldest = outstanding.length
    ? Math.max(...outstanding.map(x => daysSince(x.drive_date)))
    : 0

  const pickedDays = outstanding.filter(x => picked.has(x.id))
  // D14: the envelope holds the family's share and Marwa's together.
  const owed = pickedDays.reduce((a, x) => a + x.family_egp + x.marwa_egp, 0)

  function toggle(id: string) {
    setPicked(s => {
      const n = new Set(s)
      n.has(id) ? n.delete(id) : n.add(id)
      return n
    })
  }

  async function confirm() {
    setErr(null)
    const c = toPiastres(counted)
    if (!c) return setErr(t('err_amount'))
    setBusy(true)
    try {
      await confirmHandover({
        familyId: family.id, dayIds: [...picked], receivedOn: today(),
        countedEgp: c, note: note || null, clientUuid: newClientUuid(),
      })
      setPicked(new Set()); setCounted(''); setNote('')
      load.reload()
    } catch (e) {
      setErr((e as { message?: string }).message ?? t('err_load'))
    } finally { setBusy(false) }
  }

  async function doVoid(id: string) {
    setErr(null); setBusy(true)
    try {
      await voidCarDay(id, reason || t('car_void_default'))
      setVoiding(null); setReason('')
      load.reload()
    } catch (e) {
      setErr((e as { message?: string }).message ?? t('err_load'))
    } finally { setBusy(false) }
  }

  return (
    <div className="stack">
      <div className="kpis">
        <Kpi label={t('kpi_with_driver')} pending={pending} value={money(held, lang)}
             note={t('kpi_with_driver_note')} />
        <Kpi label={t('car_days_month')} pending={pending}
             value={String(monthDays.filter(x => x.worked).length)} />
        <Kpi label={t('car_net_month')} pending={pending}
             value={money(monthDays.reduce((a, x) => a + x.net_egp, 0), lang)} />
        <Kpi label={t('car_owed_marwa')} pending={pending} value={money(marwaOwed, lang)}
             note={t('car_owed_marwa_note')} />
      </div>

      {err && <div className="notice warn">{err}</div>}

      {!pending && oldest >= HANDOVER_NUDGE_DAYS && (
        <div className={'notice' + (oldest >= HANDOVER_ALARM_DAYS ? ' warn' : '')}>
          {oldest >= HANDOVER_ALARM_DAYS ? t('car_nudge_hard') : t('car_nudge')}
          {' · '}{t('car_nudge_oldest')} {fmtDay(
            outstanding.reduce((a, x) => (x.drive_date < a ? x.drive_date : a),
                               outstanding[0].drive_date), lang)}
        </div>
      )}

      {!pending && !!losses.length && isAdmin && (
        <LossQueue days={losses} costs={d!.costs} cats={d!.cats} lang={lang}
                   onDone={load.reload} />
      )}

      <div className="card">
        <div className="cardhead">
          <h2>{t('car_outstanding')}</h2>
          {!!outstanding.length && <span className="badge pending">{outstanding.length}</span>}
        </div>
        <p className="sub">{t('car_outstanding_sub')}</p>

        {load.loading && <p className="sub" style={{ padding: '14px 0' }}>{t('loading')}</p>}
        {load.failed && (
          <p className="sub" style={{ padding: '14px 0' }}>
            {t('err_load')} <button className="linkbtn" onClick={load.reload}>{t('retry')}</button>
          </p>
        )}
        {!pending && !outstanding.length && (
          <p className="sub" style={{ padding: '14px 0' }}>{t('car_all_settled')}</p>
        )}

        <div className="rows">
          {outstanding.map(x => (
            <DayRow key={x.id} row={x} lang={lang} costs={d!.costs}
                    selectable={isAdmin} selected={picked.has(x.id)}
                    onToggle={() => toggle(x.id)}
                    onVoid={isAdmin ? () => { setVoiding(voiding === x.id ? null : x.id); setReason('') } : undefined}
                    voiding={voiding === x.id} reason={reason} setReason={setReason}
                    confirmVoid={() => void doVoid(x.id)} busy={busy} />
          ))}
        </div>

        {isAdmin && picked.size > 0 && (
          <div className="rateedit" style={{ marginTop: 14 }}>
            <div className="field">
              <label>{`${t('car_counted')} (${t('f_amount_unit')})`}</label>
              <input className="input" inputMode="decimal" value={counted} autoFocus
                     onChange={e => setCounted(e.target.value)}
                     placeholder={(owed / 100).toFixed(2)} />
            </div>
            <div className="field">
              <label>{t('f_memo')} <span className="opt">· {t('f_optional')}</span></label>
              <input className="input" value={note} onChange={e => setNote(e.target.value)} />
            </div>
            <button className="btn sm" disabled={busy} onClick={() => void confirm()}>
              {busy ? t('saving') : t('car_confirm')}
            </button>
            {/* D12: a short handover is CARRIED. The receivable keeps the
                difference; nothing is written off and nobody adjusts a total. */}
            <p className="hint">
              {t('car_owed')} {money(owed, lang)} · {t('car_carry_note')}
            </p>
          </div>
        )}
      </div>

      <div className="card">
        <div className="cardhead"><h2>{t('car_handovers')}</h2></div>
        {!pending && !d?.hos.length && (
          <p className="sub" style={{ padding: '14px 0' }}>{t('nothing_yet')}</p>
        )}
        <div className="rows">
          {d?.hos.map(h => {
            const short = h.amount_egp - h.counted_egp
            return (
              <div className="row" key={h.id}>
                <div className="dot" style={{ background: 'var(--accent)' }} />
                <div className="rowmain">
                  <div className="rowtitle">
                    {fmtDay(h.received_on, lang)}
                    {short !== 0 && (
                      <span className="badge warn">
                        {short > 0 ? t('car_short') : t('car_over')} {money(Math.abs(short), lang)}
                      </span>
                    )}
                  </div>
                  <div className="rowsub">
                    {t('car_owed')} {money(h.amount_egp, lang)}
                    {h.note && <> · {h.note}</>}
                  </div>
                </div>
                <div className="amt plus">{money(h.counted_egp, lang)}</div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

/**
 * D13. These days cost more than they took, so nobody shared them and nothing
 * posted. Joe is out of pocket until Abdo records the shortfall as a family
 * expense and hands him the cash.
 *
 * The category and the note are Abdo's to choose, and the note is not
 * optional in spirit even though the column allows null: "car maintenance"
 * six months from now is the difference between a record and a mystery.
 */
function LossQueue({ days, costs, cats, lang, onDone }: {
  days: CarDay[]; costs: any[]; cats: any[]; lang: 'en' | 'ar'; onDone: () => void
}) {
  const { t } = useT()
  const [open, setOpen] = useState<string | null>(null)
  const [categoryId, setCategoryId] = useState('')
  const [memo, setMemo] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const expense = cats.filter((c: any) => c.kind === 'expense')

  async function settle(id: string) {
    setErr(null)
    if (!categoryId) return setErr(t('err_category'))
    setBusy(true)
    try {
      await settleCarLoss({ dayId: id, categoryId, memo, clientUuid: newClientUuid() })
      setOpen(null); setCategoryId(''); setMemo('')
      onDone()
    } catch (e) {
      setErr((e as { message?: string }).message ?? t('err_load'))
    } finally { setBusy(false) }
  }

  return (
    <div className="card">
      <div className="cardhead">
        <h2>{t('car_needs_you')}</h2>
        <span className="badge warn">{days.length}</span>
      </div>
      <p className="sub">{t('car_needs_you_sub')}</p>
      {err && <p className="errmsg">{err}</p>}

      <div className="rows">
        {days.map(x => {
          const mine = costs.filter((c: any) => c.car_day_id === x.id)
          return (
            <div className="row alrow" key={x.id}>
              <div className="dot" style={{ background: 'var(--expense)' }} />
              <div className="rowmain">
                <div className="rowtitle">{fmtDay(x.drive_date, lang)}</div>
                <div className="rowsub">
                  {money(x.gross_egp, lang)} − {money(x.direct_egp + x.indirect_egp, lang)}
                  {!!mine.length && <> · {mine.map((c: any) =>
                    c.description || t(`cost_${c.label}` as any)).join(', ')}</>}
                </div>
              </div>
              <div className="amt minus">{money(x.net_egp, lang)}</div>
              <button className="btn sm ghost"
                      onClick={() => { setOpen(open === x.id ? null : x.id); setCategoryId(''); setMemo('') }}>
                {t('car_settle')}
              </button>

              {open === x.id && (
                <div className="rateedit">
                  <div className="field">
                    <label>{t('f_category')}</label>
                    <select className="input" value={categoryId} autoFocus
                            onChange={e => setCategoryId(e.target.value)}>
                      <option value="">—</option>
                      {expense.map((c: any) => (
                        <option key={c.id} value={c.id}>
                          {lang === 'ar' ? c.name_ar : c.name_en}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="field">
                    <label>{t('car_settle_note')}</label>
                    <input className="input" value={memo} placeholder={t('car_settle_eg')}
                           onChange={e => setMemo(e.target.value)} />
                  </div>
                  <button className="btn sm" disabled={busy} onClick={() => void settle(x.id)}>
                    {busy ? t('saving') : `${t('car_settle_confirm')} ${money(-x.net_egp, lang)}`}
                  </button>
                  <p className="hint">{t('car_settle_hint')}</p>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function DayRow({ row, lang, costs, selectable, selected, onToggle, onVoid,
                  voiding, reason, setReason, confirmVoid, busy }: any) {
  const { t } = useT()
  const mine = costs.filter((c: any) => c.car_day_id === row.id)
  return (
    <div className="row alrow">
      {selectable && (
        <input type="checkbox" checked={selected} onChange={onToggle}
               aria-label={row.drive_date} />
      )}
      <div className="dot" style={{ background: row.worked ? 'var(--trend)' : 'var(--neutral)' }} />
      <div className="rowmain">
        <div className="rowtitle">
          {fmtDay(row.drive_date, lang)}
          {!row.worked && <span className="badge">{t('day_off')}</span>}
        </div>
        <div className="rowsub">
          {row.worked && <>
            {money(row.gross_egp, lang)} − {money(row.direct_egp + row.indirect_egp, lang)}
            {!!mine.length && <> · {mine.map((c: any) => t(`cost_${c.label}` as any)).join(', ')}</>}
          </>}
        </div>
      </div>
      <div className={'amt ' + (row.family_egp >= 0 ? 'plus' : 'minus')}>
        {money(row.family_egp, lang)}
      </div>
      {onVoid && (
        <button className="linkbtn inline" onClick={onVoid}>{t('car_void')}</button>
      )}
      {voiding && (
        <div className="rateedit">
          <div className="field">
            <label>{t('car_void_why')}</label>
            <input className="input" value={reason} autoFocus
                   onChange={(e: any) => setReason(e.target.value)} />
          </div>
          <button className="btn sm" disabled={busy} onClick={confirmVoid}>
            {t('car_void_confirm')}
          </button>
          <p className="hint">{t('car_void_note')}</p>
        </div>
      )}
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

export type { CarDay }
