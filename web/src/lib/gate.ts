// The AppShield gate in front of this app owns sign-in and sign-out.
export const LOGIN_PATH = '/nhl-auth/oidc/login'
export const LOGOUT_PATH = '/nhl-auth/logout'

/** Ends the local-account session too (Authelia), then the gate's. */
export async function logout(upstreamLogoutUrl: string) {
  if (upstreamLogoutUrl) {
    try {
      await fetch(upstreamLogoutUrl, { method: 'POST', mode: 'no-cors', credentials: 'include' })
    } catch {
      // Best effort: the gate logout below still ends this app's session.
    }
  }
  location.assign(LOGOUT_PATH)
}
