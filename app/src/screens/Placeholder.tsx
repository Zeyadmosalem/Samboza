import { useOutletContext } from 'react-router-dom'
import { useT } from '../lib/i18n'
import type { Family, Person } from '../lib/supabase'

interface Ctx { person: Person; family: Family; code: string }

/** Every route resolves and the shell is real; the money screens are Phase 2. */
export default function Placeholder({ name }: { name: string }) {
  const { t } = useT()
  const { person, family, code } = useOutletContext<Ctx>()

  return (
    <div className="card">
      <h2>{t(`nav_${name}` as any)}</h2>
      <p className="sub">{t('coming_in_phase_2')}</p>

      <div style={{ marginTop: 18, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <span className={`pill ${person.role}`}>{t(`role_${person.role}` as any)}</span>
        <span className="mono">{code}</span>
        <span className="mono" style={{ color: 'var(--sub)' }}>{family.code}</span>
      </div>
    </div>
  )
}
