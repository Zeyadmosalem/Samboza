import { supabase } from './supabase'

/**
 * Writes that could not be sent, kept until they can be.
 *
 * WHY THIS IS SAFE, AND WHY IT WOULD NOT BE WITHOUT client_uuid. Joe records
 * Tuesday in a basement car park. The request goes out, the server takes it,
 * and the reply never comes back. He presses submit again. Without an id the
 * family owns Tuesday twice and their income is wrong; with one, the second
 * attempt returns the first row and nothing happens. Every write path in this
 * app has carried a client_uuid since it was written — this is the machinery
 * that finally uses it for the thing it was for.
 *
 * THE DISTINCTION THAT MATTERS: a request that never arrived is worth
 * retrying forever, and one the server REFUSED is not. "That month has
 * already been paid" will be refused identically at every future attempt, so
 * retrying is an infinite loop that also hides the problem. Network failures
 * stay queued; server rejections are surfaced and taken out of the queue.
 */

export type OutboxKind =
  | 'record_transaction' | 'member_expense' | 'record_car_day'
  | 'record_remittance' | 'pay_allowance' | 'confirm_handover'
  | 'record_loan' | 'record_loan_payment'

export interface Pending {
  id: string
  kind: OutboxKind
  args: Record<string, unknown>
  /** What the family would call it, for the "waiting to send" list. */
  label: string
  queuedAt: number
  attempts: number
  /** Set when the SERVER refused it. It will never succeed; it needs a human. */
  rejected?: string
}

const KEY = 'samboza-outbox'
const listeners = new Set<(q: Pending[]) => void>()

function read(): Pending[] {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '[]') } catch { return [] }
}
function write(q: Pending[]) {
  try { localStorage.setItem(KEY, JSON.stringify(q)) } catch { /* private mode */ }
  listeners.forEach(f => f(q))
}

export const outbox = () => read()
export function subscribe(f: (q: Pending[]) => void) {
  listeners.add(f)
  f(read())
  return () => { listeners.delete(f) }
}

export function enqueue(kind: OutboxKind, args: Record<string, unknown>, label: string) {
  const q = read()
  // The client_uuid is the identity, so re-queueing the same submission twice
  // replaces rather than duplicates.
  const uuid = args.p_client_uuid ?? args.client_uuid
  const at = q.findIndex(p => (p.args.p_client_uuid ?? p.args.client_uuid) === uuid)
  const row: Pending = {
    id: String(uuid ?? Math.random()), kind, args, label,
    queuedAt: Date.now(), attempts: 0,
  }
  if (at >= 0) q[at] = { ...q[at], ...row } ; else q.push(row)
  write(q)
}

export function discard(id: string) {
  write(read().filter(p => p.id !== id))
}

/**
 * A failure that means "the message never arrived", as opposed to one that
 * means "the server read it and said no".
 *
 * supabase-js surfaces a dropped connection as a TypeError from fetch with no
 * status; PostgREST rejections arrive with a code. Anything without a code and
 * without a status is treated as transport — the safe direction, because a
 * queued item can always be discarded by hand and a discarded one cannot be
 * recovered.
 */
function isTransport(e: unknown): boolean {
  if (!navigator.onLine) return true
  const err = e as { code?: string; status?: number; message?: string }
  if (err?.status && err.status >= 400 && err.status < 500) return false
  if (err?.code && /^[0-9A-Z]{5}$/.test(err.code)) return false      // a Postgres SQLSTATE
  return /fetch|network|Failed to fetch|timeout|abort/i.test(err?.message ?? '') || !err?.code
}

async function send(p: Pending) {
  if (p.kind === 'member_expense') {
    const { error } = await supabase.from('member_expenses').insert(p.args as never)
    // A retry of a submission the server DID take comes back as a unique
    // violation on client_uuid. That is success arriving late, not a failure.
    if (error && error.code !== '23505') throw error
    return
  }
  const { error } = await supabase.rpc(p.kind, p.args as never)
  if (error) throw error
}

let running = false

/** Try everything waiting. Safe to call as often as you like. */
export async function flush(): Promise<{ sent: number; kept: number; rejected: number }> {
  if (running) return { sent: 0, kept: 0, rejected: 0 }
  running = true
  try {
    let q = read()
    let sent = 0, kept = 0, rejected = 0
    for (const p of [...q]) {
      if (p.rejected) { rejected++; continue }
      try {
        await send(p)
        q = q.filter(x => x.id !== p.id)
        sent++
      } catch (e) {
        if (isTransport(e)) {
          q = q.map(x => x.id === p.id ? { ...x, attempts: x.attempts + 1 } : x)
          kept++
          // Nothing else will get through either; stop hammering.
          break
        }
        q = q.map(x => x.id === p.id
          ? { ...x, rejected: (e as { message?: string }).message ?? 'refused' } : x)
        rejected++
      }
      write(q)
    }
    write(q)
    return { sent, kept, rejected }
  } finally {
    running = false
  }
}

/**
 * Do the write, and if it cannot go out now, keep it.
 *
 * Returns 'sent' or 'queued' so a form can say which happened. Telling
 * somebody "saved" when it is sitting in a queue is the kind of small lie
 * that ends with a month of the car unrecorded.
 */
export async function writeOrQueue(
  kind: OutboxKind, args: Record<string, unknown>, label: string,
): Promise<'sent' | 'queued'> {
  if (!navigator.onLine) { enqueue(kind, args, label); return 'queued' }
  try {
    await send({ id: '', kind, args, label, queuedAt: 0, attempts: 0 })
    return 'sent'
  } catch (e) {
    if (isTransport(e)) { enqueue(kind, args, label); return 'queued' }
    throw e
  }
}

/** Flush on every signal that the world might have changed. */
export function startOutbox() {
  const go = () => { if (navigator.onLine) void flush() }
  window.addEventListener('online', go)
  document.addEventListener('visibilitychange', () => { if (!document.hidden) go() })
  // A backstop for the case the browser never fires `online` — which happens
  // on a phone moving between a dead wifi and mobile data.
  setInterval(go, 60_000)
  go()
}
