/**
 * Split "wisera.inojob.com" → {userDomain: "wisera", serverDomain: "inojob.com"}.
 * The mesh-router-backend resolves on the user-domain piece alone (everything
 * before the first dot); everything after the first dot is the server zone
 * the backend lives under. Returns empty strings if the input doesn't have
 * the expected shape — caller should treat as "skip the check".
 *
 * Two callers with different needs, which is why this lives here rather than
 * next to either of them:
 *   - Migration.ts — resolves the destination against the mesh-router backend.
 *   - brand/resolveBrand.ts — the serverDomain is the domain-provider key
 *     ("nsl.sh", "inojob.com") used to pick a fallback dashboard link.
 */
export function splitDomain(fqdn: string): {userDomain: string; serverDomain: string} {
    const idx = fqdn.indexOf('.');
    if (idx <= 0 || idx === fqdn.length - 1) return {userDomain: '', serverDomain: ''};
    return {userDomain: fqdn.slice(0, idx), serverDomain: fqdn.slice(idx + 1)};
}
