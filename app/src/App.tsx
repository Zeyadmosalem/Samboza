import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider, useAuth } from './lib/auth'
import { I18nProvider, useT } from './lib/i18n'
import Login from './screens/Login'
import Shell from './components/Shell'
import Placeholder from './screens/Placeholder'

/** Phase 2 fills these in. Phase 1 delivers the shell they hang from. */
const SCREENS = [
  'dashboard', 'add', 'carday', 'myearnings', 'remittance', 'allowance',
  'car', 'loans', 'myspending', 'mymoney', 'mymonth', 'approvals',
  'history', 'reports', 'people', 'settings',
]

function Gate() {
  const { loading, session, person } = useAuth()
  const { t } = useT()

  if (loading) return <div className="centred">{t('loading')}</div>
  if (!session) return <Login />

  // Authenticated, but attached to no family. A real state — someone was
  // deactivated, or an account exists with no person row — so it gets a
  // message rather than an empty shell or a crash.
  if (!person) {
    return (
      <div className="centred">
        <div className="card" style={{ maxWidth: 420, textAlign: 'center' }}>
          <p>{t('err_no_membership')}</p>
        </div>
      </div>
    )
  }

  return (
    <Routes>
      <Route element={<Shell />}>
        {SCREENS.map(s => (
          <Route key={s} path={`/${s}`} element={<Placeholder name={s} />} />
        ))}
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Route>
    </Routes>
  )
}

export default function App() {
  return (
    <I18nProvider>
      <AuthProvider>
        <BrowserRouter>
          <Gate />
        </BrowserRouter>
      </AuthProvider>
    </I18nProvider>
  )
}
