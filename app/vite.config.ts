import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * The offline shell.
 *
 * A hand-written service worker rather than a plugin, for one reason: the
 * precache list must be the files this build actually produced. Vite hashes
 * every filename, so a hardcoded list rots on the next build and a stale
 * worker serves a bundle that no longer exists — which fails silently, and
 * only for the people who already had the app open. Reading the list off the
 * bundle at the moment it is written is the only version that cannot drift.
 *
 * The API is deliberately NOT cached. A stale balance is worse than no
 * balance, and writes made offline are not lost — they go to the outbox and
 * out when there is a signal.
 */
function offlineShell(): Plugin {
  return {
    name: 'samboza-offline-shell',
    apply: 'build',
    generateBundle(_options, bundle) {
      const assets = Object.keys(bundle)
        .filter(f => !f.endsWith('.map'))
        .map(f => './' + f)
      const precache = JSON.stringify(['./', './index.html', ...assets])

      this.emitFile({
        type: 'asset',
        fileName: 'sw.js',
        source: `/* Generated at build time from the real bundle. Do not edit. */
const CACHE = 'samboza-${Date.now().toString(36)}'
const SHELL = ${precache}

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()))
})

self.addEventListener('activate', e => {
  // One cache per build. Anything older is a bundle nobody is running.
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()))
})

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url)
  if (e.request.method !== 'GET') return
  // Never the API. A cached balance that is three days old is worse than a
  // screen that admits it does not know.
  if (url.origin !== self.location.origin) return

  e.respondWith(
    caches.match(e.request).then(hit => hit || fetch(e.request).catch(() =>
      // A navigation with no signal still has to land somewhere: the shell
      // it was cached with. The app then renders whatever it can and the
      // outbox keeps whatever gets recorded.
      e.request.mode === 'navigate' ? caches.match('./index.html') : undefined))
  )
})
`,
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), offlineShell()],
  // Capacitor (phase 5) serves the built files from disk, so every asset
  // reference has to be relative rather than rooted at /.
  base: './',
  build: { outDir: 'dist', sourcemap: true },
})
