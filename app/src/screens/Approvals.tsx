import { useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { useT, money } from '../lib/i18n'
import { useLoad } from '../lib/useLoad'
import { supabase, type Family, type Person } from '../lib/supabase'
import { categories, decideSubmission, fmtDay, pendingSubmissions } from '../lib/data'

interface Ctx { person: Person; family: Family; code: string }

/**
 * The queue Abdo decides.
 *
 * `decide_member_expense` is guarded on the CURRENT status inside the
 * function, not on what this screen last rendered, so two devices deciding
 * the same row cannot both succeed. It returns FALSE when somebody got there
 * first — which is not an error and must not be shown as one; the row is
 * simply gone on reload.
 *
 * A rejection carries a reason because the member sees it. "Rejected" with no
 * explanation is how a ledger becomes a family argument.
 */
export default function Approvals() {
  const { family } = useOutletContext<Ctx>()
  const { t, lang } = useT()

  const [busy, setBusy] = useState<string | null>(null)
  const [rejecting, setRejecting] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const [err, setErr] = useState<string | null>(null)

  const load = useLoad(async () => {
    const [queue, people, cats] = await Promise.all([
      pendingSubmissions(family.id),
      supabase.from('people').select('id,display_name')
        .eq('family_id', family.id)
        .then(r => { if (r.error) throw r.error; return r.data as { id: string; display_name: string }[] }),
      categories(family.id),
    ])
    return { queue, people, cats }
  }, [family.id])

  const d = load.data

  async function decide(id: string, status: 'approved' | 'rejected') {
    setErr(null); setBusy(id)
    try {
      await decideSubmission(id, status, status === 'rejected' ? reason : undefined)
      setRejecting(null); setReason('')
      load.reload()
    } catch (e) {
      setErr((e as { message?: string }).message ?? t('err_load'))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="stack">
      {err && <div className="notice warn">{err}</div>}

      <div className="card">
        <div className="cardhead">
          <h2>{t('nav_approvals')}</h2>
          {!!d?.queue.length && <span className="badge pending">{d.queue.length}</span>}
        </div>
        <p className="sub">{t('ap_sub')}</p>

        {load.loading && <p className="sub" style={{ padding: '14px 0' }}>{t('loading')}</p>}
        {load.failed && (
          <p className="sub" style={{ padding: '14px 0' }}>
            {t('err_load')} <button className="linkbtn" onClick={load.reload}>{t('retry')}</button>
          </p>
        )}
        {!load.loading && !load.failed && !d?.queue.length && (
          <p className="sub" style={{ padding: '14px 0' }}>{t('ap_empty')}</p>
        )}

        <div className="rows">
          {d?.queue.map(row => {
            const who = d.people.find(p => p.id === row.person_id)?.display_name ?? '—'
            const cat = d.cats.find(c => c.id === row.category_id)
            return (
              <div className="row alrow" key={row.id}>
                <div className="dot" style={{ background: cat?.colour ?? 'var(--neutral)' }} />
                <div className="rowmain">
                  <div className="rowtitle">
                    {who}
                    <span className="badge">{(lang === 'ar' ? cat?.name_ar : cat?.name_en) ?? '—'}</span>
                  </div>
                  <div className="rowsub">
                    {fmtDay(row.occurred_on, lang)}
                    {row.description && <> · {row.description}</>}
                  </div>
                </div>

                <div className="amt minus">{money(-row.amount_egp, lang)}</div>

                <div className="rowact">
                  <button className="btn sm" disabled={busy === row.id}
                          onClick={() => void decide(row.id, 'approved')}>
                    {busy === row.id ? t('saving') : t('ap_approve')}
                  </button>
                  <button className="btn sm ghost" disabled={busy === row.id}
                          onClick={() => { setRejecting(rejecting === row.id ? null : row.id); setReason('') }}>
                    {t('ap_reject')}
                  </button>
                </div>

                {rejecting === row.id && (
                  <div className="rateedit">
                    <div className="field">
                      <label>{t('ap_reason')}</label>
                      <input className="input" value={reason} autoFocus
                             onChange={e => setReason(e.target.value)} />
                    </div>
                    <button className="btn sm" disabled={busy === row.id}
                            onClick={() => void decide(row.id, 'rejected')}>
                      {t('ap_confirm_reject')}
                    </button>
                    <p className="hint">{t('ap_reason_note')}</p>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
