import { useEffect, useState } from 'react'
import { useT } from '../lib/i18n'

export function LangToggle() {
  const { lang, setLang } = useT()
  return (
    <div className="langtoggle">
      <button className={lang === 'en' ? 'on' : ''} onClick={() => setLang('en')}>EN</button>
      <button className={lang === 'ar' ? 'on' : ''} onClick={() => setLang('ar')}>ع</button>
    </div>
  )
}

type Theme = 'light' | 'dark'

function resolved(): Theme {
  const set = document.documentElement.dataset.theme
  if (set === 'dark' || set === 'light') return set
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function ThemeToggle() {
  const { t } = useT()
  const [theme, setTheme] = useState<Theme>(resolved)

  // Follow the OS only while the viewer has made no explicit choice.
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => { if (!document.documentElement.dataset.theme) setTheme(resolved()) }
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  function flip() {
    const next: Theme = theme === 'dark' ? 'light' : 'dark'
    document.documentElement.dataset.theme = next
    try { localStorage.setItem('samboza-theme', next) } catch { /* private mode */ }
    setTheme(next)
  }

  return (
    <button className="themetoggle" onClick={flip} aria-label={t('theme_toggle')} title={t('theme_toggle')}>
      {theme === 'dark' ? (
        <svg viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24">
          <path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a6.8 6.8 0 0 0 10.5 10.5Z" />
        </svg>
      )}
    </button>
  )
}
