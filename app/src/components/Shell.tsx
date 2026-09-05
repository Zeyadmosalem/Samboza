import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { useT } from '../lib/i18n'
import { memberCode, type Role } from '../lib/supabase'
import { LangToggle, ThemeToggle } from './Toggles'
import { discard, flush, subscribe, type Pending } from '../lib/outbox'

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

/**
 * What has not gone out yet, and whether there is a signal at all.
 *
 * Deliberately at the top of every screen rather than tucked into a menu: a
 * queue nobody can see is a queue nobody empties, and the entire point of
 * keeping a submission on the phone is that it eventually leaves it.
 */
function OutboxBanner() {
  const { t } = useT()
  const [queue, setQueue] = useState<Pending[]>([])
  const [online, setOnline] = useState(navigator.onLine)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const un = subscribe(setQueue)
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => {
      un()
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
    }
  }, [])

  const rejected = queue.filter(p => p.rejected)
  const waiting = queue.filter(p => !p.rejected)
  if (online && !queue.length) return null

  return (
    <div className={'notice outbox' + (rejected.length ? ' warn' : '')}>
      {!online && <div>{t('ob_offline')}</div>}
      {!!waiting.length && (
        <div className="outboxrow">
          <span>{waiting.length} {t(waiting.length === 1 ? 'ob_waiting_one' : 'ob_waiting_many')}</span>
          {online && (
            <button className="btn sm ghost" disabled={busy}
                    onClick={async () => { setBusy(true); await flush(); setBusy(false) }}>
              {busy ? t('ob_sending') : t('ob_send_now')}
            </button>
          )}
        </div>
      )}
      {/* A rejection will be rejected identically for ever, so it is shown
          rather than retried, and removing it is a decision somebody makes. */}
      {rejected.map(p => (
        <div className="outboxrow" key={p.id}>
          <span>{p.label} — {p.rejected}</span>
          <button className="btn sm ghost" onClick={() => discard(p.id)}>{t('ob_discard')}</button>
        </div>
      ))}
    </div>
  )
}

export default function Shell() {
  const { person, family, signOut, stale } = useAuth()
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
          {/* Not a detail. Every number on every screen behind this banner was
              fetched at some earlier point and may have moved; saying so is
              cheaper than a family arguing about a balance that was right
              yesterday. */}
          {stale && <div className="notice flat">{t('ob_stale')}</div>}
          <OutboxBanner />
          <Outlet context={{ person, family, code: memberCode(family, person) }} />
        </div>
      </div>
    </div>
  )
}
