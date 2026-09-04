import { useState, type FormEvent } from 'react'
import { useAuth } from '../lib/auth'
import { useT } from '../lib/i18n'
import { LangToggle, ThemeToggle } from '../components/Toggles'

export default function Login() {
  const { signIn } = useAuth()
  const { t } = useT()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

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
              placeholder="you@samboza.family"
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
            onClick={() => setError('forgot_note' as any)}
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
