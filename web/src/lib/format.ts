// Locale-aware formatting. The locale is Paraglide's, so dates and sizes follow
// the language the page is in.
import { getLocale } from './paraglide/runtime.js'
import { m } from './paraglide/messages.js'

const loc = () => getLocale()

export function ago(iso: string | number | Date | null | undefined): string {
  if (iso === null || iso === undefined || iso === '') return '—'
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return '—'
  const s = Math.round((t - Date.now()) / 1000)
  const rtf = new Intl.RelativeTimeFormat(loc(), { numeric: 'auto' })
  const abs = Math.abs(s)
  if (abs < 60) return rtf.format(s, 'second')
  if (abs < 3600) return rtf.format(Math.round(s / 60), 'minute')
  if (abs < 86400) return rtf.format(Math.round(s / 3600), 'hour')
  return rtf.format(Math.round(s / 86400), 'day')
}

export function dateTime(iso: string | number | Date | null | undefined): string {
  if (iso === null || iso === undefined || iso === '') return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString(loc(), { dateStyle: 'medium', timeStyle: 'short' })
}

/** A host log timestamp (YYYY-MM-DDTHH:MM:SS, host clock, no zone), shown as written. */
export function hostStamp(s: string | null | undefined): string {
  return s ? s.replace('T', ' ') : '—'
}

export function bytes(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let i = 0
  let v = n
  while (v >= 1000 && i < units.length - 1) {
    v /= 1000
    i++
  }
  return `${new Intl.NumberFormat(loc(), { maximumFractionDigits: v < 10 && i > 0 ? 1 : 0 }).format(v)} ${units[i]}`
}

export function duration(s: number | null | undefined): string {
  if (s === null || s === undefined) return ''
  if (s < 60) return m.duration_seconds({ s })
  return m.duration_minutes({ m: Math.floor(s / 60), s: s % 60 })
}

/** "every night at 03:00" for the common cron shapes, else the raw expression. */
export function cronText(expr: string): string {
  const v = expr.trim()
  if (v === 'disabled' || v === 'off') return m.schedule_disabled()
  const f = v.split(/\s+/)
  if (f.length === 5 && /^\d+$/.test(f[0]) && /^\d+$/.test(f[1]) && f[2] === '*' && f[3] === '*' && f[4] === '*') {
    const d = new Date(2000, 0, 1, Number(f[1]), Number(f[0]))
    return m.schedule_daily({ time: d.toLocaleTimeString(loc(), { hour: '2-digit', minute: '2-digit' }) })
  }
  return v
}
