// Server-side codes (status tiles, issues, API error codes) → messages. The
// server never sends prose; each code `a.b` is the message `status_a_b`
// (tiles/issues) or `error_<code>` (API errors). A code without a message
// falls back to a generic line, so a newer server never shows a raw key.
import { m } from './paraglide/messages.js'
import { ApiError } from './api'
import { ago, bytes, dateTime } from './format'

type Fn = (p?: Record<string, unknown>) => string
const lookup = (key: string): Fn | undefined => (m as unknown as Record<string, Fn>)[key]

/** Formats the params a status code carries: times relative, sizes human. */
function prepare(params: Record<string, string | number> = {}): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(params)) {
    if (k === 'at' || k === 'until') out[k] = ago(v)
    else if (k === 'used' || k === 'size' || k === 'avail') out[k] = bytes(Number(v))
    else out[k] = String(v)
  }
  out.when = params.at ? dateTime(params.at) : ''
  return out
}

export function statusText(code: string, params?: Record<string, string | number>): string {
  const fn = lookup('status_' + code.replace(/[.-]/g, '_'))
  return fn ? fn(prepare(params)) : m.status_unknown_code()
}

export function errorText(e: unknown): string {
  if (e instanceof ApiError) {
    const fn = e.code ? lookup('error_' + e.code.replace(/[.-]/g, '_')) : undefined
    if (fn) return fn()
    return m.error_generic({ detail: e.message })
  }
  return m.error_generic({ detail: e instanceof Error ? e.message : String(e) })
}
