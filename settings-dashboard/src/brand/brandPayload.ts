/**
 * Pure brand transforms — no `fs`, no `getConfig`, no env.
 *
 * Kept free of Node imports on purpose: brandDefaultPayload.ts pulls this into
 * the BROWSER bundle to seed the client fallback. Anything added here that
 * touches `fs` or `@/configuration/getConfigBackend` will drag the server
 * config reader into the client build.
 */
import type {BrandFile, BrandPayload, DomainProvider} from './BrandTypes';

/**
 * Merge an override onto the baked default.
 *
 * Merge policy, per key:
 *   brand            — shallow merge, so an override can set only `name`.
 *   domainProviders  — merge BY KEY, so an override can add a zone without
 *                      restating the ones it doesn't care about.
 *   operator         — REPLACED wholesale, never merged. A half-specified
 *                      operator (name but no dashboardUrl) is worse than none:
 *                      it renders a panel with a dead link.
 *
 * `operator: null` explicitly means "no operator"; an ABSENT operator key
 * inherits the default. That distinction is the whole point of using
 * hasOwnProperty here rather than a truthiness check — `?? default` would
 * silently turn an intentional null back into Yundera.
 */
export function mergeBrandFile(base: BrandFile, override: Partial<BrandFile>): BrandFile {
    const hasOperatorKey = Object.prototype.hasOwnProperty.call(override, 'operator');
    return {
        schemaVersion: base.schemaVersion,
        brand: {...base.brand, ...(override.brand ?? {})},
        operator: hasOperatorKey ? (override.operator ?? null) : base.operator,
        domainProviders: {
            ...base.domainProviders,
            ...(override.domainProviders ?? {}),
        } as Record<string, DomainProvider>,
    };
}

/**
 * Flatten a BrandFile into what the UI consumes.
 *
 * The operator precedence is the core domain rule of this whole feature:
 *
 *     operator ?? domainProviders[serverDomain] ?? null
 *
 * The CONFIGURED OPERATOR ALWAYS WINS, even when the domain belongs to someone
 * else. A Yundera customer on an `nsl.sh` domain (yunderalabs.nsl.sh is the
 * live example) must be sent to Yundera's dashboard, not nsl.sh's — Yundera is
 * who runs that box and manages the domain on their behalf.
 *
 * `hasOperator` is decided by the CALLER, not here, because it depends on env
 * (`YUNDERA_API`) that this module deliberately cannot see.
 */
export function toBrandPayload(
    file: BrandFile,
    opts: {hasOperator: boolean; serverDomain: string},
): BrandPayload {
    const operator = opts.hasOperator ? file.operator : null;
    const domainProvider: DomainProvider | null =
        file.domainProviders?.[opts.serverDomain] ?? null;

    const resolvedOperator = operator
        ? {
            name: operator.name,
            panelLabel: operator.panelLabel,
            dashboardLabel: operator.dashboardLabel,
            dashboardUrl: operator.dashboardUrl,
        }
        : domainProvider
            ? {
                name: domainProvider.label,
                panelLabel: domainProvider.panelLabel,
                dashboardLabel: domainProvider.dashboardLabel,
                dashboardUrl: domainProvider.dashboardUrl,
            }
            : null;

    return {
        brand: file.brand,
        hasOperator: !!operator,
        support: {
            enabled: !!operator && operator.support.enabled,
            operatorName: operator ? operator.name : null,
        },
        operator: resolvedOperator,
        operatorAccount: operator?.accountUrl
            ? {name: operator.name, url: operator.accountUrl}
            : null,
    };
}
