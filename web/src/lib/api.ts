// Thin fetch wrapper. Every request goes through the AppShield gate with the
// session cookie; the custom header on writes is what the server's CSRF guard
// checks (a cross-site page cannot set it without a preflight we never answer).

import { LOGIN_PATH } from './gate'

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    /** Stable error code from the server (internal/server writeError). */
    public code?: string,
  ) {
    super(message)
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (method !== 'GET') {
    headers['X-Yundera-Admin'] = '1'
    headers['Content-Type'] = 'application/json'
  }
  const res = await fetch(path, {
    method,
    headers,
    credentials: 'same-origin',
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  let data: unknown = undefined
  try {
    data = text ? JSON.parse(text) : undefined
  } catch {
    // The gate answers an expired session with a login page, not JSON.
  }
  if (res.status === 401) {
    // The gate session ended: go sign in again and come back here.
    location.assign(`${LOGIN_PATH}?redirect=${encodeURIComponent(location.pathname + location.search)}`)
    throw new ApiError(401, 'signed out', 'unauthenticated')
  }
  if (!res.ok) {
    const d = data as { error?: string; code?: string } | undefined
    throw new ApiError(res.status, d?.error ?? `${res.status} ${res.statusText}`, d?.code)
  }
  if (data === undefined) {
    throw new ApiError(res.status, 'unexpected response', 'session_expired')
  }
  return data as T
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body ?? {}),
}

// ---- response shapes (mirror internal/server) ------------------------------

export type Level = 'ok' | 'info' | 'warn' | 'bad' | 'unknown'

export interface Links {
  base: string
  root: string
  maison: string
  maisonBackups: string
  kopia: string
  authConsole: string
  authAccess: string
  meshConsole: string
  meshDomain: string
  dashboard: string
}

export interface Me {
  user: { id: string; fullName: string; email: string; role: 'admin' | 'user'; provider: string }
  upstreamLogoutUrl: string
  version: string
  domain: string
  links: Links
}

export interface Tile {
  level: Level
  code: string
  params?: Record<string, string | number>
}

export interface Issue extends Tile {
  page: string
}

export type TileName = 'healthCheck' | 'updates' | 'connection' | 'storage' | 'support'

export interface Overview {
  domain: string
  publicIp: string
  version: string
  links: Links
  running: boolean
  summary: { level: Level; tiles: Record<TileName, Tile>; issues: Issue[] }
}

export interface Script {
  name: string
  status: 'success' | 'failed' | 'running'
  durationSec: number | null
  exitCode: number | null
  startedAt: string | null
  endedAt: string | null
  output: string[]
  outputTruncated: boolean
}

export interface Run {
  startedAt: string | null
  endedAt: string | null
  status: 'success' | 'failures' | 'running' | 'interrupted'
  passed: number
  failed: number
  total: number
  durationSec: number | null
  scripts: Script[]
  truncated: boolean
}

export interface SelfCheck {
  run: Run | null
  running: boolean
}

export interface Schedule {
  value: string
  effective: string
  default: string
}

export type ChannelId = 'stable' | 'main' | 'local' | 'frozen' | 'custom'

export interface UpdateChannel {
  updateUrl: string
  channel: ChannelId
}

export type FeatureId = 'yundera-login' | 'support-key' | 'platform-updates'

export interface Feature {
  id: FeatureId
  enabled: boolean | null
  error?: string
}

export type SlideId = 'account' | 'backup'

/** pending: wants the owner now; skipped: "Skip for now", back 3 days later. */
export interface Slide {
  id: SlideId
  state: 'pending' | 'done' | 'skipped'
  skippedAt?: string
}

export type BackupState = 'needs-secret' | 'needs-recovery' | 'ready' | 'disabled' | 'unavailable'

export interface BackupStatus {
  enabled: boolean
  state: BackupState
  engine?: string
}

export type BackupAction = 'status' | 'enable' | 'disable' | 'init' | 'recover' | 'reset'

/** A long backup action runs on the server; POST /api/backup answers 202 with it. */
export interface BackupJob {
  job: 'idle' | 'running' | 'done' | 'failed'
  action?: BackupAction
  startedAt?: string
  endedAt?: string
  backup?: BackupStatus
  code?: string
  error?: string
}

export interface OnboardingStatus {
  claimed: boolean
  completed: boolean
  username: string
  slides: Slide[]
  backup: BackupStatus
  backupJob?: BackupJob
}

export interface Support {
  ensure: boolean
  accessEnabled: boolean
  username: string
  fingerprint: string
  comment: string
}
