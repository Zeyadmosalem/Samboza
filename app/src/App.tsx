import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider, useAuth } from './lib/auth'
import { I18nProvider, useT } from './lib/i18n'
import Login from './screens/Login'
import Shell from './components/Shell'
import Placeholder from './screens/Placeholder'
import Dashboard from './screens/Dashboard'
import AddTransaction from './screens/AddTransaction'
import History from './screens/History'
import Allowance from './screens/Allowance'
import MySpending from './screens/MySpending'
import Approvals from './screens/Approvals'
import CarDay from './screens/CarDay'
import Car from './screens/Car'
import MyEarnings from './screens/MyEarnings'

/** Steps 1–4 of Phase 2 are real. The rest still hang from the shell as
 *  placeholders, in the order the plan builds them. */
const BUILT: Record<string, () => JSX.Element> = {
  dashboard: Dashboard,
  add: AddTransaction,
  history: History,
  allowance: Allowance,
  myspending: MySpending,
  approvals: Approvals,
  carday: CarDay,
  car: Car,
  myearnings: MyEarnings,
}

const SCREENS = [
  'dashboard', 'add', 'carday', 'myearnings', 'remittance', 'allowance',
  'car', 'loans', 'myspending', 'mymoney', 'mymonth', 'approvals',
  'history', 'reports', 'people', 'settings',
]

function Gate() {
  const { loading, session, person, membershipError, reload } = useAuth()
  const { t } = useT()

  if (loading) return <div className="centred">{t('loading')}</div>
  if (!session) return <Login />

  // The lookup FAILED — a connection problem, not a permissions one. Saying
  // "you are not attached to a family" here would be a false accusation, and
  // the fix is a retry rather than a phone call to Abdo.
  if (membershipError) {
    return (
      <div className="centred">
        <div className="card" style={{ maxWidth: 460, textAlign: 'center' }}>
          <p>{t('err_membership_load')}</p>
          <button className="btn" style={{ marginTop: 16 }} onClick={reload}>
            {t('retry')}
          </button>
        </div>
      </div>
    )
  }

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
        {SCREENS.map(s => {
          const Built = BUILT[s]
          return (
            <Route
              key={s}
              path={`/${s}`}
              element={Built ? <Built /> : <Placeholder name={s} />}
            />
          )
        })}
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
