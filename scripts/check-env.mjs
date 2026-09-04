/**
 * Diagnose a "Invalid API key" without ever revealing the key.
 *
 * Prints only shape and length — never the value, so the output is safe to
 * paste anywhere. Run: node check-env.mjs
 */
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const envPath = resolve(here, '..', '.env')

console.log('\nLooking for:', envPath)

if (!existsSync(envPath)) {
  console.log('\n  NOT FOUND.')
  console.log('  From the repo root run:  copy .env.example .env')
  console.log('  then open .env and paste the service_role key.\n')
  process.exit(1)
}
console.log('  found\n')

const env = {}
for (const line of readFileSync(envPath, 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/)
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}

const url = env.SUPABASE_URL
const key = env.SUPABASE_SERVICE_ROLE_KEY

/* ---------------------------------------------------------------- URL */
console.log('SUPABASE_URL')
if (!url) {
  console.log('  MISSING')
} else if (!/^https:\/\/[a-z]{20}\.supabase\.co\/?$/.test(url)) {
  console.log('  looks wrong:', url)
  console.log('  expected exactly:  https://cinjcssbtfsirbyqwxsh.supabase.co')
} else {
  console.log('  ok:', url)
}

/* ---------------------------------------------------------------- key */
console.log('\nSUPABASE_SERVICE_ROLE_KEY')
if (!key) {
  console.log('  MISSING — the line is absent or empty')
} else if (/^your-|^<|placeholder/i.test(key)) {
  console.log('  STILL THE PLACEHOLDER. Open .env and paste the real key.')
} else {
  console.log('  length:', key.length)
  const parts = key.split('.')
  if (key.startsWith('sb_secret_')) {
    console.log('  shape: new-style secret key (sb_secret_…) — fine for admin calls')
  } else if (key.startsWith('sb_publishable_')) {
    console.log('  shape: PUBLISHABLE key — WRONG. That is the public one.')
    console.log('         You need the secret / service_role key.')
  } else if (parts.length === 3) {
    try {
      const claims = JSON.parse(Buffer.from(parts[1], 'base64').toString())
      console.log('  shape: JWT, role =', claims.role ?? '(none)')
      if (claims.role !== 'service_role') {
        console.log('         WRONG KEY. This is the "' + claims.role + '" key.')
        console.log('         Use the one labelled service_role / secret.')
      }
      if (claims.ref && url && !url.includes(claims.ref)) {
        console.log('         MISMATCH: this key belongs to project', claims.ref)
      }
    } catch {
      console.log('  shape: three dot-separated parts but the middle will not decode —')
      console.log('         probably truncated on copy. Re-copy the whole string.')
    }
  } else {
    console.log('  shape: unrecognised — not a JWT and not sb_secret_…')
    console.log('         Likely a partial copy. Use the copy button in the dashboard.')
  }
  if (/\s/.test(key)) console.log('  WARNING: contains whitespace or a line break')
}

/* ------------------------------------------------------------ live test
   Only worth running once the key is the RIGHT KIND. The anon key connects
   perfectly well and then fails on the first privileged write, so a bare
   "it connects" is a misleading thing to report. */
let roleOk = false
if (key) {
  if (key.startsWith('sb_secret_')) roleOk = true
  else {
    const parts = key.split('.')
    if (parts.length === 3) {
      try { roleOk = JSON.parse(Buffer.from(parts[1], 'base64').toString()).role === 'service_role' }
      catch { roleOk = false }
    }
  }
}

if (key && !roleOk && !/^your-/i.test(key)) {
  console.log(String.fromCharCode(10) + 'VERDICT: wrong key. Not testing further — it would connect and then be')
  console.log('refused on the first write, which is what row-level security is for.')
  console.log(String.fromCharCode(10) + 'Get the service_role key: Supabase → Settings → API → Project API keys')
  console.log('→ the row labelled service_role (click Reveal, then the copy button).')
  console.log('Newer dashboard: Settings → API Keys → Secret keys.' + String.fromCharCode(10))
  process.exit(1)
}

if (url && key && roleOk) {
  console.log('\nTesting against Supabase…')
  const { createClient } = await import('@supabase/supabase-js')
  const db = createClient(url.replace(/\/$/, ''), key, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { error } = await db.from('families').select('id').limit(1)
  if (error) {
    console.log('  FAILED:', error.message)
    if (/Invalid API key/i.test(error.message)) {
      console.log('\n  The key is not accepted by this project. Check that you copied')
      console.log('  the service_role / secret key from THIS project, whole.')
    }
  } else {
    console.log('  OK — the key works. Run: node bootstrap.mjs')
  }
}
console.log()
