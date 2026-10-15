// v1 was a hash-routed react-admin app, and its links live on in places this
// app does not control: the orchestrator's support deeplink
// (`#/access?account=…&pubkeyUrl=…`), pcs-dashboard (`#/access?…&autoEnable=1`),
// Maison's feedback `supportUrl` from older boxes (`#/support`), bookmarks.
// Panels that moved out go to their new console; the rest map to their page
// here. Runs once, before the app mounts.

const moved: Record<string, { prefix: string; path: string }> = {
  access: { prefix: 'auth-console', path: '/access' },
  account: { prefix: 'auth-console', path: '/' },
  domain: { prefix: 'mesh-console', path: '/domain' },
}

const local: Record<string, string> = {
  support: '/support',
  'yundera-features': '/features',
  health: '/checkup',
  'system-information': '/',
  operator: '/',
}

/** Returns true when the browser is being sent elsewhere. */
export function forwardLegacyHash(): boolean {
  const m = /^#\/([a-z-]+)(\?.*)?$/.exec(location.hash)
  if (!m) return false
  const [, panel, query = ''] = m
  const host = location.hostname
  const target = moved[panel]
  if (target && host.startsWith('admin-')) {
    location.replace(`${location.protocol}//${target.prefix}-${host.slice('admin-'.length)}${target.path}${query}`)
    return true
  }
  const path = local[panel] ?? '/'
  history.replaceState(null, '', path + query)
  return false
}
