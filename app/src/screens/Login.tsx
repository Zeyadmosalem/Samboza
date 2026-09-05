import { useState, type FormEvent } from 'react'
import { useAuth } from '../lib/auth'
import { useT } from '../lib/i18n'
import { LangToggle, ThemeToggle } from '../components/Toggles'

/**
 * A link that has expired says so in the URL fragment rather than anywhere a
 * person would look. Read it once, on load, so somebody who waited a day
 * before clicking is told to ask for another one instead of being returned
 * to the sign-in screen with no explanation.
 */
function expiredLink(): boolean {
  const h = window.location.hash
  return /error/.test(h) && /expired|invalid/.test(h)
}

export default function Login() {
  const { signIn, sendReset } = useAuth()
  const { t } = useT()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  /** The card has two jobs and shows one at a time. */
  const [mode, setMode] = useState<'in' | 'reset'>(() => (expiredLink() ? 'reset' : 'in'))
  const [sent, setSent] = useState(false)
  const [notice, setNotice] = useState<string | null>(() => (expiredLink() ? 'err_link_expired' : null))

  async function onReset(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const { error } = await sendReset(email)
    setBusy(false)
    if (error) return setError(error)
    // Deliberately the same words whether or not that address has an account.
    setSent(true)
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const { error } = await signIn(email, password)
    if (error) {
      setError(error)
      setBusy(false)
    }
    // On success the auth listener swaps the whole tree; nothing to do here.
  }

  if (mode === 'reset') {
    return (
      <div className="auth">
        <div className="auth-card">
          <div className="brandmark">S</div>
          <h1>{t('reset_title')}</h1>
          <p className="sub">{sent ? t('reset_sent') : t('reset_sub')}</p>

          {notice && <div className="errmsg" role="alert">{t(notice as any)}</div>}

          {!sent && (
            <form onSubmit={onReset}>
              <div className="field">
                <label htmlFor="remail">{t('email')}</label>
                <input
                  id="remail"
                  className="input"
                  type="email"
                  autoComplete="username"
                  required
                  disabled={busy}
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="you@example.com"
                />
              </div>
              {error && <div className="errmsg" role="alert">{t(error as any)}</div>}
              <button className="btn wide" type="submit" disabled={busy} style={{ marginTop: 18 }}>
                {busy ? t('ob_sending') : t('reset_send')}
              </button>
            </form>
          )}

          <button
            className="linkbtn"
            type="button"
            onClick={() => { setMode('in'); setSent(false); setError(null); setNotice(null) }}
          >
            {t('back_to_sign_in')}
          </button>

          <div style={{ marginTop: 14, display: 'flex', justifyContent: 'center', gap: 8 }}>
            <LangToggle />
            <ThemeToggle />
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="auth">
      <div className="auth-card">
        <div className="brandmark">S</div>
        <div className="famline">
          {t('signing_into')} <b>{t('family')}</b>
        </div>
        <h1>{t('login_title')}</h1>
        <p className="sub">{t('login_sub')}</p>

        <form onSubmit={onSubmit}>
          <div className="field">
            <label htmlFor="email">{t('email')}</label>
            <input
              id="email"
              className="input"
              type="email"
              autoComplete="username"
              required
              disabled={busy}
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="you@example.com"
            />
          </div>

          <div className="field">
            <label htmlFor="password">{t('password')}</label>
            <input
              id="password"
              className="input"
              type="password"
              autoComplete="current-password"
              required
              disabled={busy}
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="••••••••"
            />
          </div>

          {/* One message for a wrong address and a wrong password alike:
              distinguishing them tells whoever is guessing which addresses
              exist. */}
          {error && <div className="errmsg" role="alert">{t(error as any)}</div>}

          <button className="btn wide" type="submit" disabled={busy} style={{ marginTop: 18 }}>
            {busy ? t('signing_in') : t('sign_in')}
          </button>

          <button
            className="linkbtn"
            type="button"
            onClick={() => { setMode('reset'); setError(null); setNotice(null) }}
          >
            {t('forgot')}
          </button>
        </form>

        <p className="hint">{t('session_note')}</p>
        <div style={{ marginTop: 14, display: 'flex', justifyContent: 'center', gap: 8 }}>
          <LangToggle />
          <ThemeToggle />
        </div>
      </div>
    </div>
  )
}
