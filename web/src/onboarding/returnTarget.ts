// Where to send the owner once onboarding is settled. Maison's gate sends an
// unclaimed owner to the wizard with ?return=<its own URL>; only a URL on this
// same box is honoured — the base domain itself, or any `<prefix>-<base>`
// sibling (maison-, a store app) — so the parameter cannot turn the wizard
// into an open redirect. Ported from v1's onboardingReturn.ts.

function boxBase(): string | null {
  const host = location.host
  return host.startsWith('admin-') ? host.slice('admin-'.length) : null
}

export function readReturnTarget(search: string = location.search): string | null {
  const raw = new URLSearchParams(search).get('return')
  if (!raw) return null
  const base = boxBase()
  if (!base) return null
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null // relative or malformed: not something Maison sends
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  if (url.host !== base && !url.host.endsWith(`-${base}`)) return null
  return url.toString()
}
