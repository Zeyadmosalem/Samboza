import { useMemo, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { useT } from '../lib/i18n'
import { useLoad } from '../lib/useLoad'
import { supabase, type Family, type Person, type Role } from '../lib/supabase'
import {
  categories, newClientUuid, recordTransaction, submitExpense, toPiastres, today,
  type Category,
} from '../lib/data'

interface Ctx { person: Person; family: Family; code: string }

/**
 * One route, two genuinely different acts.
 *
 * Abdo records a movement of FAMILY money and it posts immediately. A member
 * records a movement of money the family already gave them, and it waits.
 * They are not the same form with a flag: one goes through a SECURITY DEFINER
 * function into a balanced journal, the other is a row in a sub-ledger that
 * never touches the ledger at all — because the family already expensed the
 * allowance, and counting the spending again would double-count it.
 */
export default function AddTransaction() {
  const { person } = useOutletContext<Ctx>()
  return (person.role as Role) === 'admin' ? <AdminForm /> : <MemberForm />
}

/* ------------------------------------------------------------- shared --- */

function useCats(familyId: string) {
  return useLoad(() => categories(familyId), [familyId])
}

function Field({ label, hint, children }: {
  label: string; hint?: string; children: React.ReactNode
}) {
  return (
    <div className="field">
      <label>
        {label}
        {hint && <span className="opt"> · {hint}</span>}
      </label>
      {children}
    </div>
  )
}

/** Postgres speaks English and speaks it bluntly. Map what we recognise, and
 *  show the rest verbatim rather than replacing a specific complaint with a
 *  vague one. */
function serverMessage(e: unknown): string {
  const m = (e as { message?: string })?.message ?? ''
  if (/has not happened yet/i.test(m)) return 'err_future'
  if (/needs a recipient/i.test(m)) return 'err_recipient'
  if (/positive number of piastres/i.test(m)) return 'err_amount'
  if (/no such category/i.test(m)) return 'err_category'
  return m || 'err_load'
}

/* -------------------------------------------------------------- admin --- */

function AdminForm() {
  const { person, family } = useOutletContext<Ctx>()
  const { t } = useT()
  const cats = useCats(family.id)

  const [kind, setKind] = useState<'income' | 'expense'>('expense')
  const [categoryId, setCategoryId] = useState('')
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState(today())
  const [personId, setPersonId] = useState('')
  const [memo, setMemo] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [done, setDone] = useState<Sent>(null)
  // Generated once per attempt and REUSED on retry: a submit that times out
  // and is pressed again must post once, not twice.
  const [clientUuid, setClientUuid] = useState(newClientUuid)

  const people = useLoad(async () => {
    const { data, error } = await supabase
      .from('people').select('id,display_name')
      .eq('family_id', family.id).eq('active', true).order('member_no')
    if (error) throw error
    return data as { id: string; display_name: string }[]
  }, [family.id])

  const visible = useMemo(
    () => (cats.data ?? []).filter(c => c.kind === kind),
    [cats.data, kind],
  )
  const chosen = visible.find(c => c.id === categoryId)

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setErr(null)
    const piastres = toPiastres(amount)
    if (!piastres) return setErr('err_amount')
    if (!categoryId) return setErr('err_category')
    if (date > today()) return setErr('err_future')
    if (chosen?.needs_recipient && !personId) return setErr('err_recipient')

    setBusy(true)
    try {
      setDone(await recordTransaction({
        familyId: family.id, kind, categoryId, amount: piastres,
        occurredOn: date, personId: personId || null, memo: memo || null,
        clientUuid,
      }))
    } catch (e) {
      setErr(serverMessage(e))
    } finally {
      setBusy(false)
    }
  }

  function again() {
    setDone(null); setAmount(''); setMemo(''); setPersonId('')
    setClientUuid(newClientUuid())   // a NEW transaction, so a new identity
  }

  if (done) return <Done sent={done} message={t('saved')} onAgain={again} />

  return (
    <form className="card form" onSubmit={save}>
      <div className="cardhead">
        <h2>{t('nav_add')}</h2>
      </div>
      <p className="sub">{t('add_sub_admin')}</p>

      <div className="seg" style={{ marginTop: 18 }}>
        {(['expense', 'income'] as const).map(k => (
          <button key={k} type="button"
                  className={'segbtn' + (kind === k ? ' on' : '')}
                  onClick={() => { setKind(k); setCategoryId('') }}>
            {t(k === 'income' ? 'add_income' : 'add_expense')}
          </button>
        ))}
      </div>

      <div className="grid2">
        <Field label={`${t('f_amount')} (${t('f_amount_unit')})`}>
          <input className="input" inputMode="decimal" value={amount} autoFocus
                 onChange={e => setAmount(e.target.value)} placeholder="0.00" />
        </Field>

        <Field label={t('f_date')}>
          <input className="input" type="date" value={date} max={today()}
                 onChange={e => setDate(e.target.value)} />
        </Field>
      </div>

      <Field label={t('f_category')}>
        <select className="input" value={categoryId}
                disabled={cats.loading || !visible.length}
                onChange={e => setCategoryId(e.target.value)}>
          <option value="">—</option>
          {visible.map(c => <option key={c.id} value={c.id}>{c.name_en}</option>)}
        </select>
        {/* An empty dropdown with no explanation reads as a broken screen. */}
        {!cats.loading && !cats.failed && !visible.length &&
          <p className="hint">{t('no_categories')}</p>}
      </Field>

      <Field label={t('f_person')} hint={chosen?.needs_recipient ? undefined : t('f_optional')}>
        <select className="input" value={personId}
                onChange={e => setPersonId(e.target.value)}>
          <option value="">{t('f_person_none')}</option>
          {(people.data ?? []).map(p => (
            <option key={p.id} value={p.id}>{p.display_name}</option>
          ))}
        </select>
      </Field>

      <Field label={t('f_memo')} hint={t('f_optional')}>
        <input className="input" value={memo} onChange={e => setMemo(e.target.value)} />
      </Field>

      {err && <p className="errmsg">{translate(err, t)}</p>}
      {cats.failed && <p className="errmsg">{t('err_load')}</p>}

      <button className="btn wide" style={{ marginTop: 20 }} disabled={busy}>
        {busy ? t('saving') : t('save')}
      </button>
      <p className="hint" style={{ marginTop: 12 }}>
        {person.display_name} · {t('role_admin')}
      </p>
    </form>
  )
}

/* ------------------------------------------------------------- member --- */

function MemberForm() {
  const { person, family } = useOutletContext<Ctx>()
  const { t } = useT()
  const cats = useCats(family.id)

  const [categoryId, setCategoryId] = useState('')
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState(today())
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [done, setDone] = useState<Sent>(null)
  const [clientUuid, setClientUuid] = useState(newClientUuid)

  const visible = (cats.data ?? []).filter((c: Category) => c.kind === 'expense')

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setErr(null)
    const piastres = toPiastres(amount)
    if (!piastres) return setErr('err_amount')
    if (!categoryId) return setErr('err_category')
    if (date > today()) return setErr('err_future')

    setBusy(true)
    try {
      setDone(await submitExpense({
        familyId: family.id, personId: person.id, categoryId,
        amount: piastres, occurredOn: date, description, clientUuid,
      }))
    } catch (e) {
      setErr(serverMessage(e))
    } finally {
      setBusy(false)
    }
  }

  function again() {
    setDone(null); setAmount(''); setDescription('')
    setClientUuid(newClientUuid())
  }

  if (done) return <Done sent={done} message={t('submitted')} onAgain={again} />

  return (
    <form className="card form" onSubmit={save}>
      <div className="cardhead">
        <h2>{t('nav_add')}</h2>
      </div>
      <p className="sub">{t('add_sub_member')}</p>

      <div className="grid2" style={{ marginTop: 18 }}>
        <Field label={`${t('f_amount')} (${t('f_amount_unit')})`}>
          <input className="input" inputMode="decimal" value={amount} autoFocus
                 onChange={e => setAmount(e.target.value)} placeholder="0.00" />
        </Field>

        <Field label={t('f_date')}>
          <input className="input" type="date" value={date} max={today()}
                 onChange={e => setDate(e.target.value)} />
        </Field>
      </div>

      <Field label={t('f_category')}>
        <select className="input" value={categoryId}
                disabled={cats.loading || !visible.length}
                onChange={e => setCategoryId(e.target.value)}>
          <option value="">—</option>
          {visible.map(c => <option key={c.id} value={c.id}>{c.name_en}</option>)}
        </select>
        {!cats.loading && !cats.failed && !visible.length &&
          <p className="hint">{t('no_categories')}</p>}
      </Field>

      <Field label={t('f_desc')} hint={t('f_optional')}>
        <input className="input" value={description}
               onChange={e => setDescription(e.target.value)} />
      </Field>

      {err && <p className="errmsg">{translate(err, t)}</p>}
      {cats.failed && <p className="errmsg">{t('err_load')}</p>}

      <button className="btn wide" style={{ marginTop: 20 }} disabled={busy}>
        {busy ? t('saving') : t('submit')}
      </button>
    </form>
  )
}

/* --------------------------------------------------------------- done --- */

/**
 * 'sent' and 'queued' are not the same news and must not read the same. A
 * member told "sent to Abdo" when it is sitting on their phone will not
 * mention it again, and neither will Abdo, because he never saw it.
 */
export type Sent = 'sent' | 'queued' | null

function Done({ sent, message, onAgain }: {
  sent: Sent; message: string; onAgain: () => void
}) {
  const { t } = useT()
  const queued = sent === 'queued'
  return (
    <div className="card form">
      <div className={'donemark' + (queued ? ' waiting' : '')}>{queued ? '↑' : '✓'}</div>
      <h2 style={{ textAlign: 'center', marginTop: 12 }}>
        {queued ? t('ob_saved_here') : message}
      </h2>
      {queued && <p className="sub" style={{ textAlign: 'center' }}>{t('ob_will_send')}</p>}
      <button className="btn wide ghost" style={{ marginTop: 22 }} onClick={onAgain}>
        {t('add_another')}
      </button>
    </div>
  )
}

/** A known key gets translated; anything else is the database talking and is
 *  shown as it came. */
const translate = (key: string, t: (k: any) => string) =>
  /^[a-z_]+$/.test(key) ? t(key) : key
