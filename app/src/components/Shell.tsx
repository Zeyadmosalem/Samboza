import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { useT } from '../lib/i18n'
import { memberCode, type Role } from '../lib/supabase'
import { LangToggle, ThemeToggle } from './Toggles'

/**
 * Which screens exist for which role. This mirrors the RLS policies rather
 * than replacing them: hiding a nav item is a courtesy, and the database is
 * what actually refuses. Anyone typing the URL directly still hits a policy.
 */
const ACCESS: Record<string, Role[]> = {
  dashboard:  ['admin', 'member', 'viewer', 'driver'],
  add:        ['admin', 'member'],
  carday:     ['driver'],
  myearnings: ['driver'],
  remittance: ['admin', 'viewer'],
  allowance:  ['admin', 'viewer'],
  car:        ['admin', 'viewer'],
  loans:      ['admin', 'viewer'],
  myspending: ['member'],
  mymoney:    ['viewer'],
  mymonth:    ['viewer'],
  approvals:  ['admin'],
  history:    ['admin', 'member', 'viewer'],
  reports:    ['admin', 'viewer'],
  people:     ['admin'],
  settings:   ['admin'],
}

const GROUPS: { group: string; items: string[] }[] = [
  { group: 'nav_group_money',  items: ['dashboard', 'add', 'carday', 'remittance', 'allowance', 'car', 'loans'] },
  { group: 'nav_group_family', items: ['myspending', 'myearnings', 'approvals', 'history', 'reports', 'people'] },
  { group: 'nav_group_own',    items: ['mymoney', 'mymonth'] },
  { group: 'nav_group_admin',  items: ['settings'] },
]

/** Ghada sees two groups, not four: what she watches, and what is hers. */
const VIEWER_GROUPS: typeof GROUPS = [
  { group: 'nav_group_view', items: ['dashboard', 'remittance', 'allowance', 'car', 'loans', 'history', 'reports'] },
  { group: 'nav_group_own',  items: ['mymoney', 'mymonth'] },
]

export default function Shell() {
  const { person, family, signOut } = useAuth()
  const { t } = useT()
  const location = useLocation()

  if (!person || !family) return null
  const role = person.role as Role
  const groups = role === 'viewer' ? VIEWER_GROUPS : GROUPS
  const current = location.pathname.replace('/', '') || 'dashboard'
  const initials = person.display_name.trim().slice(0, 2)

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brandmark">S</div>
          <div>
            <div className="t">{t('family')}</div>
            <div className="s">{t('tagline')}</div>
          </div>
        </div>

        {groups.map(g => {
          const items = g.items.filter(s => ACCESS[s]?.includes(role))
          if (!items.length) return null
          return (
            <div key={g.group}>
              <div className="navgroup">{t(g.group as any)}</div>
              {items.map(s => (
                <NavLink
                  key={s}
                  to={`/${s}`}
                  className={({ isActive }) => 'navitem' + (isActive ? ' on' : '')}
                >
                  {t(`nav_${s}` as any)}
                </NavLink>
              ))}
            </div>
          )
        })}
      </aside>

      <div className="main">
        <header className="topbar">
          <h1>{t(`nav_${current}` as any)}</h1>
          <div className="spacer" />
          <LangToggle />
          <ThemeToggle />
          <button className="userchip" onClick={() => void signOut()} title={t('sign_out')}>
            <span>
              <span className="n">{person.display_name}</span>
              <br />
              <span className="r">{t(`role_${role}` as any)}</span>
            </span>
            <span className="avatar">{initials}</span>
          </button>
        </header>

        <div className="page">
          <Outlet context={{ person, family, code: memberCode(family, person) }} />
        </div>
      </div>
    </div>
  )
}
