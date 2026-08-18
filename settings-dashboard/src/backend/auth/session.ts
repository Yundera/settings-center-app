import {NextApiRequest} from 'next';
import {IncomingHttpHeaders} from 'http';
import {GateIdentity, readGateIdentity} from './gateIdentity';

/**
 * The signed-in user, as the rest of the app has always seen it.
 *
 * The shape is unchanged on purpose: ~40 route handlers and the SPA's
 * authProvider read it, and none of them needed to care that the identity now
 * arrives from the AppShield gate rather than from a cookie this app signed
 * itself. `readSession()` is the only seam that moved.
 */
export interface SessionUser {
  id: string;
  fullName: string;
  email: string;
  avatar: string;
  role: string;
  /** How the gate authenticated the caller: oidc | password | hash | oauth. */
  provider: string;
}

/**
 * Groups that confer administrator rights on this PCS.
 *
 * Vendor-neutral by design: this app ships in the FOSS mesh template as well as
 * the managed one, so it must not know the name of any particular identity
 * provider. Any IdP wired into this PCS's Dex asserts administrator status the
 * same way — by putting the account in `admins`.
 *
 * Producers today: Authelia (ensure-authelia.sh seeds the operator account into
 * `admins`; the Account panel assigns it), and on managed boxes the operator
 * IdP, whose owner policy is fail-closed — only the uid bound as owner_uid at
 * client registration can complete an authorize against this PCS.
 */
const ADMIN_GROUPS = ['admin', 'admins'];

/**
 * Collapse the groups claim to this dashboard's binary role.
 *
 * Deliberately binary: a raw group name leaking into an authorization field is a
 * hazard now that adminMiddleware gates every /api/admin route on it.
 */
function deriveRole(groups: string[]): string {
  return groups.some(g => ADMIN_GROUPS.includes(g)) ? 'admin' : 'user';
}

function toSessionUser(identity: GateIdentity): SessionUser {
  return {
    id: identity.user,
    fullName: identity.name || identity.user,
    email: identity.email,
    avatar: '',
    role: deriveRole(identity.groups),
    provider: identity.method,
  };
}

/** Identity for an API request, or null when the gate vouched for nobody. */
export async function readSession(req: NextApiRequest): Promise<SessionUser | null> {
  return readSessionFromHeaders(req.headers);
}

/**
 * Same, from a bare header bag.
 *
 * Needed because two entry points never see a NextApiRequest: the pre-Next page
 * gate in server.ts (serverGate.ts) and the terminal WebSocket upgrade, which
 * Node hands us before any framework runs.
 */
export async function readSessionFromHeaders(
  headers: IncomingHttpHeaders,
): Promise<SessionUser | null> {
  const identity = await readGateIdentity(headers);
  return identity ? toSessionUser(identity) : null;
}
