import { useState, type FormEvent } from 'react'
import { useAuth } from '../lib/auth'
import { useT } from '../lib/i18n'
import { LangToggle, ThemeToggle } from '../components/Toggles'

/** Short enough that Grandma will accept it, long enough to be worth having.
 *  Supabase enforces its own minimum too; this one exists to say so before
 *  the round trip rather than after it. */
const MIN = 8

/**
 * SET A PASSWORD — from a reset link, or while signed in.
 *
 * The reset link is what makes each person's password their own. Until this
 * screen existed the only way to have one was for somebody else to set it,
 * which means somebody else knows it — and every RLS policy in this project
 * assumes people cannot sign in as each other.
 */
export default function SetPassword({ onDone }: { onDone?: () => void }) {
  const { setPassword, finishRecovery, recovery, person } = useAuth()
  const { t } = useT()
  const [pw, setPw] = useState('')
  const [again, setAgain] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)

  const tooShort = pw.length > 0 && pw.length < MIN
  const mismatch = again.length > 0 && pw !== again

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    // Both boxes, and both agreeing. A typo in a password you cannot see and
    // are about to be signed out with is a phone call to Abdo.
    if (pw.length < MIN) return setError('err_pw_weak')
    if (pw !== again) return setError('err_pw_mismatch')
    setBusy(true)
    setError(null)
    const { error } = await setPassword(pw)
    setBusy(false)
    if (error) return setError(error)
    setDone(true)
  }

  if (done) {
    return (
      <div className="auth">
        <div className="auth-card">
          <div className="brandmark">S</div>
          <h1>{t('pw_set_title')}</h1>
          <p className="sub">{t('pw_set_done')}</p>
          <button
            className="btn wide"
            style={{ marginTop: 18 }}
            onClick={() => (onDone ? onDone() : finishRecovery())}
          >
            {t('continue')}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="auth">
      <div className="auth-card">
        <div className="brandmark">S</div>
        {person && <div className="famline">{person.display_name}</div>}
        <h1>{t('pw_set_title')}</h1>
        <p className="sub">{recovery ? t('pw_set_sub_reset') : t('pw_set_sub')}</p>

        <form onSubmit={onSubmit}>
          <div className="field">
            <label htmlFor="pw">{t('pw_new')}</label>
            <input
              id="pw"
              className="input"
              type="password"
              autoComplete="new-password"
              required
              disabled={busy}
              value={pw}
              onChange={e => { setPw(e.target.value); setError(null) }}
              placeholder="••••••••"
            />
            <div className="hint">{tooShort ? t('pw_too_short') : t('pw_rule')}</div>
          </div>

          <div className="field">
            <label htmlFor="again">{t('pw_again')}</label>
            <input
              id="again"
              className="input"
              type="password"
              autoComplete="new-password"
              required
              disabled={busy}
              value={again}
              onChange={e => { setAgain(e.target.value); setError(null) }}
              placeholder="••••••••"
            />
            {mismatch && <div className="hint">{t('pw_mismatch')}</div>}
          </div>

          {error && <div className="errmsg" role="alert">{t(error as any)}</div>}

          <button
            className="btn wide"
            type="submit"
            style={{ marginTop: 18 }}
            disabled={busy || pw.length < MIN || pw !== again}
          >
            {busy ? t('saving') : t('pw_save')}
          </button>
        </form>

        <div style={{ marginTop: 14, display: 'flex', justifyContent: 'center', gap: 8 }}>
          <LangToggle />
          <ThemeToggle />
        </div>
      </div>
    </div>
  )
}
