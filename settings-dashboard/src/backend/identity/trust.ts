import {createRemoteJWKSet, JWTVerifyGetKey} from 'jose';
import {executeHostCommand} from '@/backend/cmd/HostExecutor';
import {operatorApi} from '@/configuration/operatorApi';
import {yndPath, yndScriptsPrelude} from '@/configuration/yndRoot';

/**
 * Who may push this box an identity: the trusted issuer and its key set.
 *
 * The issuer is `TRUST_ISSUER` from `.pcs.env` when set, otherwise
 * `${OPERATOR_API}/auth` — the operator's own login IdP, which is what signs
 * the bundles (pcs-orchestrator doc/identity-push.md, "Trust domain and keys").
 * Deriving it from OPERATOR_API means a staging box trusts staging and a prod
 * box trusts prod with nothing extra to configure.
 *
 * The key set is found through the issuer's discovery document and cached by
 * jose, which refetches on an unknown `kid` — so a key rotation needs nothing
 * from the box.
 */
const DEFAULT_OPERATOR_API = 'https://app.yundera.com/service/pcs';
const ISSUER_TTL_MS = 5 * 60_000;

let issuerCache: {value: string; at: number} | null = null;
const keySets = new Map<string, JWTVerifyGetKey>();

/** TRUST_ISSUER lives in .pcs.env, which this container does not load: read it on the host. */
async function readTrustIssuerSetting(): Promise<string> {
    const {stdout} = await executeHostCommand(
        `${yndScriptsPrelude()}sudo -n "$YND_SCRIPTS/tools/env-file-manager.sh" get TRUST_ISSUER "${yndPath('.pcs.env')}"`,
        {timeout: 15_000},
    );
    return stdout.trim();
}

export async function trustedIssuer(): Promise<string> {
    if (issuerCache && Date.now() - issuerCache.at < ISSUER_TTL_MS) return issuerCache.value;
    const configured = await readTrustIssuerSetting();
    const value = (configured || `${(operatorApi() || DEFAULT_OPERATOR_API).replace(/\/+$/, '')}/auth`)
        .replace(/\/+$/, '');
    issuerCache = {value, at: Date.now()};
    return value;
}

export async function issuerKeySet(issuer: string): Promise<JWTVerifyGetKey> {
    const cached = keySets.get(issuer);
    if (cached) return cached;
    const res = await fetch(`${issuer}/.well-known/openid-configuration`, {signal: AbortSignal.timeout(10_000)});
    if (!res.ok) throw new Error(`issuer discovery returned ${res.status}`);
    const doc = await res.json() as {issuer?: string; jwks_uri?: string};
    // The document must describe the issuer we trust, or a misrouted URL could
    // hand us someone else's keys.
    if (doc.issuer?.replace(/\/+$/, '') !== issuer || !doc.jwks_uri) {
        throw new Error('issuer discovery does not match the trusted issuer');
    }
    const set = createRemoteJWKSet(new URL(doc.jwks_uri), {cooldownDuration: 30_000});
    keySets.set(issuer, set);
    return set;
}
