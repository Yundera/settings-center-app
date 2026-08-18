// The AppShield gate's own endpoints.
//
// This app is fronted by an AppShield sidecar (container `admin`; this app is
// `admin-app`), which owns login and logout. It has no login page of its own
// any more — these two paths are the entire contract, and they live in one file
// so a change to AppShield's routing is a one-line change here.
//
// Both are served by the gate, on the same origin as this app, and neither is
// ever reached by this app's own request handlers.
export const GATE_LOGIN_PATH = '/nhl-auth/oidc/login';
export const GATE_LOGOUT_PATH = '/nhl-auth/logout';
