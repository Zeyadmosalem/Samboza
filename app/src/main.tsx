import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'
import { startOutbox } from './lib/outbox'

startOutbox()

/* The shell has to load with no signal, or "works offline for entry" is a
   sentence rather than a feature. Registered after paint so it never delays
   the first render, and only in a real build — a service worker in front of
   the dev server caches files that change on every keystroke. */
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => { /* http, or blocked */ })
  })
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
