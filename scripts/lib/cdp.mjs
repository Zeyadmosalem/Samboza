/* A browser, driven over the Chrome DevTools Protocol.
   Node 22+ ships a global WebSocket, so this needs no dependency at all —
   which matters more than convenience here: the app has no test framework and
   adding Playwright to install 300MB of browsers for two smoke tests would be
   the tail wagging the dog. */
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CANDIDATES = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/google-chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean)

const sleep = ms => new Promise(r => setTimeout(r, ms))

export async function launch(port = 9333) {
  const exe = CANDIDATES.find(p => existsSync(p))
  if (!exe) {
    console.error('No Chrome or Edge found. Set CHROME_PATH to the executable.')
    process.exit(1)
  }
  const profile = mkdtempSync(join(tmpdir(), 'samboza-check-'))
  const proc = spawn(exe, [
    '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
    '--no-first-run', '--disable-gpu', '--window-size=1440,900', 'about:blank',
  ], { stdio: 'ignore' })

  let info
  for (let i = 0; i < 60; i++) {
    try { info = await (await fetch(`http://localhost:${port}/json/version`)).json(); break }
    catch { await sleep(250) }
  }
  if (!info) { proc.kill(); throw new Error('the browser did not start') }

  const ws = new WebSocket(info.webSocketDebuggerUrl)
  let id = 0
  const waiting = new Map()
  await new Promise(r => ws.addEventListener('open', r))
  ws.addEventListener('message', e => {
    const m = JSON.parse(e.data)
    if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id) }
  })
  const send = (method, params = {}, sessionId) => new Promise(res => {
    const n = ++id
    waiting.set(n, res)
    ws.send(JSON.stringify({ id: n, method, params, ...(sessionId ? { sessionId } : {}) }))
  })

  return {
    /**
     * A page in its OWN browser context. Sharing one context across people is
     * the mistake that makes a five-role test pass while only ever signing in
     * once — every later "sign-in" silently reuses the first session.
     */
    async page() {
      const ctx = (await send('Target.createBrowserContext', { disposeOnDetach: true }))
        .result.browserContextId
      const target = (await send('Target.createTarget', { url: 'about:blank', browserContextId: ctx }))
        .result.targetId
      const s = (await send('Target.attachToTarget', { targetId: target, flatten: true }))
        .result.sessionId
      await send('Page.enable', {}, s)
      await send('Runtime.enable', {}, s)

      const ev = async expr => {
        const r = await send('Runtime.evaluate',
          { expression: expr, returnByValue: true, awaitPromise: true }, s)
        if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.text)
        return r.result?.result?.value
      }
      return {
        ev,
        async go(url) { await send('Page.navigate', { url }, s); await sleep(900) },
        async wait(expr, ms = 15000) {
          const until = Date.now() + ms
          while (Date.now() < until) { if (await ev(expr)) return true; await sleep(250) }
          return false
        },
        text: sel => ev(`document.querySelector(${JSON.stringify(sel)})?.innerText ?? null`),
        click: sel => ev(`document.querySelector(${JSON.stringify(sel)})?.click(), true`),
        dispose: () => send('Target.disposeBrowserContext', { browserContextId: ctx }),
      }
    },
    close() {
      ws.close()
      proc.kill()
      try { rmSync(profile, { recursive: true, force: true }) } catch {}
    },
  }
}

/**
 * React's controlled inputs read `value` through a property descriptor it
 * installs itself, so a plain `el.value = x` updates the DOM and never reaches
 * onChange — the form then submits the OLD state. Calling the native setter
 * and dispatching the event is what actually types into a React input.
 */
export const type = (sel, value, kind = 'input') => `
  (() => {
    const el = document.querySelectorAll(${JSON.stringify(sel)})[0];
    if (!el) return false;
    const proto = ${kind === 'select' ? 'HTMLSelectElement' : 'HTMLInputElement'}.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event(${JSON.stringify(kind === 'select' ? 'change' : 'input')},
      { bubbles: true }));
    return true;
  })()`

export async function signIn(page, app, email, password = 'Samboza2026!') {
  await page.go(app)
  if (!await page.wait(`!!document.querySelector('input[type=password]')`)) return false
  await page.ev(type('input[type=email]', email))
  await page.ev(type('input[type=password]', password))
  await page.ev(`document.querySelector('form').requestSubmit()`)
  return page.wait(`!!document.querySelector('.shell')`)
}
