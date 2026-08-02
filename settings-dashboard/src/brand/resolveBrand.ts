import {loadBrandFile} from './loadBrandFile';
import {toBrandPayload} from './brandPayload';
import type {BrandPayload} from './BrandTypes';
import {getConfig} from '@/configuration/getConfigBackend';
import {splitDomain} from '@/backend/net/splitDomain';

/**
 * Resolves brand config for the current PCS.
 *
 * ── SECURITY INVARIANT ────────────────────────────────────────────────────
 * The BrandPayload this returns is served by GET /api/brand, which is
 * UNAUTHENTICATED (see BYPASS_PREFIXES in backend/auth/serverGate.ts). Nothing
 * from .pcs.secret.env may ever enter it. config/core.env.json.md records that
 * PROVIDER_STR / DEFAULT_PWD / UID were deliberately removed from
 * FRONTEND_PUBLIC_ENV because they pushed PCS secrets into the page — the same
 * rule applies here, with less protection, because there is no session gate.
 *
 * DOMAIN and YUNDERA_API are read here but never emitted: they are reduced to
 * a resolved link and a boolean before they cross the wire.
 * ──────────────────────────────────────────────────────────────────────────
 */

/**
 * Is this PCS operated by someone?
 *
 * Two signals ANDed, and the AND is load-bearing. The baked default carries
 * Yundera's operator block, so a self-hosted box that never dropped its own
 * brand.json would inherit it and render a Support panel whose every call
 * throws in SupportKey.ts ("YUNDERA_API not configured"). Requiring the env
 * var too makes the failure mode "no support panel" instead of "broken
 * support panel".
 *
 * Note this makes YUNDERA_API load-bearing for UI visibility, where before it
 * only gated SupportKey.ts. Managed boxes set it explicitly in .pcs.env, so
 * this is safe — but it must stay explicit.
 */
function hasOperator(): boolean {
    return loadBrandFile().operator !== null && !!getConfig('YUNDERA_API');
}

/** Never throws; degrades to the baked default. Safe from an RSC. */
export function resolveBrand(): BrandPayload {
    const file = loadBrandFile();
    const {serverDomain} = splitDomain(getConfig('DOMAIN') || '');
    return toBrandPayload(file, {hasOperator: hasOperator(), serverDomain});
}

/**
 * Host suffixes whose fetched SSH keys the Access panel marks as "trusted
 * source" rather than the neutral "TLS-verified" tone.
 *
 * Empty when there is no operator — with nobody to vouch for a host, nothing
 * is official, and claiming otherwise would be the assurance the badge exists
 * to make. Deliberately NOT user-curatable: a user who can add entries can
 * mark any host as vouched-for by the operator, which inverts the point.
 */
export function trustedPubkeyHostSuffixes(): string[] {
    const file = loadBrandFile();
    if (!hasOperator() || !file.operator) return [];
    return file.operator.trustedPubkeyHostSuffixes ?? [];
}
