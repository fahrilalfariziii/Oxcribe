const API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, '') || 'http://localhost:4000'

// Pengganti lib/socket.ts (Socket.io) memakai Server-Sent Events murni HTTP.
// Satu EventSource dipakai bersama per kombinasi kredensial (singleton per query),
// jadi banyak komponen boleh subscribe/unsubscribe tanpa menambah koneksi.
export type StreamEventType =
  | 'order:new'
  | 'order:status_updated'
  | 'order:payment_updated'
  | 'product:availability_updated'
  | 'ingredient:stock_updated'
  | 'business:cash_updated'
  | 'business:updated'

export type StreamHandler = (payload: unknown) => void
export type StreamHandlers = Partial<Record<StreamEventType, StreamHandler>>

export interface SubscribeOptions {
  token?: string
  qrToken?: string
  tableToken?: string
  handlers: StreamHandlers
  /** Dipanggil bila stream gagal berulang (mis. kredensial invalid) lalu ditutup. */
  onAuthError?: (message: string) => void
}

interface ListenerRec {
  type: StreamEventType
  handler: StreamHandler
  wrapped: (e: Event) => void
}

interface Entry {
  es: EventSource
  listeners: ListenerRec[]
  errorTimes: number[]
  dead: boolean
}

const entries = new Map<string, Entry>()

// Bila error (mis. 401/404 validasi) terjadi >5x dalam 10 detik, anggap
// kredensial invalid dan tutup stream agar tidak hot-loop reconnect.
// (EventSource me-reconnect otomatis; putus normal/sesaat hanya 1-2 error.)
const MAX_ERRORS = 5
const ERROR_WINDOW_MS = 10_000

function parseData(e: Event): unknown {
  try {
    return JSON.parse((e as MessageEvent).data as string)
  } catch {
    return null
  }
}

export function subscribeStream(opts: SubscribeOptions): () => void {
  // Jangan inisialisasi EventSource jika tidak ada token sama sekali untuk mencegah loop 400 Bad Request
  if (!opts.token && !opts.qrToken && !opts.tableToken) {
    return () => {}
  }

  const params = new URLSearchParams()
  if (opts.token) params.set('token', opts.token)
  if (opts.qrToken) params.set('qrToken', opts.qrToken)
  if (opts.tableToken) params.set('tableToken', opts.tableToken)
  const key = params.toString()

  let entry = entries.get(key)
  if (!entry || entry.dead) {
    if (entry?.dead) entries.delete(key)
    const es = new EventSource(`${API_BASE}/api/public/stream?${key}`)
    const fresh: Entry = { es, listeners: [], errorTimes: [], dead: false }
    entries.set(key, fresh)
    entry = fresh
    es.onerror = () => {
      const now = Date.now()
      fresh.errorTimes = [...fresh.errorTimes, now].filter((t) => now - t < ERROR_WINDOW_MS)
      if (fresh.errorTimes.length > MAX_ERRORS && !fresh.dead) {
        fresh.dead = true
        try {
          es.close()
        } catch {
          // abaikan
        }
        opts.onAuthError?.('Koneksi realtime ditolak server (kredensial invalid?). Polling fallback tetap jalan.')
      }
    }
  }

  const added: ListenerRec[] = []
  for (const [type, handler] of Object.entries(opts.handlers) as [StreamEventType, StreamHandler][]) {
    if (!handler) continue
    const wrapped = (e: Event) => handler(parseData(e))
    entry.es.addEventListener(type, wrapped)
    const rec: ListenerRec = { type, handler, wrapped }
    entry.listeners.push(rec)
    added.push(rec)
  }

  let done = false
  return () => {
    if (done) return
    done = true
    const current = entries.get(key)
    if (!current) return
    for (const rec of added) {
      try {
        current.es.removeEventListener(rec.type, rec.wrapped)
      } catch {
        // abaikan
      }
      const i = current.listeners.indexOf(rec)
      if (i !== -1) current.listeners.splice(i, 1)
    }
    if (current.listeners.length === 0) {
      try {
        current.es.close()
      } catch {
        // abaikan
      }
      entries.delete(key)
    }
  }
}
