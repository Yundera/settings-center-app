/**
 * Brand configuration — the contract that lets one image serve two stacks.
 *
 * Two shapes live here:
 *   - BrandFile:    what `brand.json` looks like on disk (server-side only).
 *   - BrandPayload: what `/api/brand` serves and the UI consumes. Pre-resolved,
 *                   so the client never has to know about operators, domain
 *                   zones, or which env vars are set.
 *
 * The split matters for security: BrandFile is merged from a file the operator
 * controls, BrandPayload is what crosses an UNAUTHENTICATED boundary. See the
 * header of resolveBrand.ts.
 */

/** A hosting operator — Yundera, or nobody on a self-hosted box. */
export interface OperatorConfig {
    /** Display name, e.g. "Yundera". Used in support copy and CA descriptions. */
    name: string;
    /** Where the user manages their subscription / PCS. */
    dashboardUrl: string;
    /** Link text, e.g. "Yundera Dashboard". */
    dashboardLabel: string;
    /** Sidebar label for the provider panel, e.g. "Billing". */
    panelLabel: string;
    support: { enabled: boolean };
    /**
     * Host suffixes whose SSH public keys the UI marks as coming from a
     * trusted source rather than merely a TLS-verified stranger. Only
     * meaningful when there IS an operator to vouch for them.
     */
    trustedPubkeyHostSuffixes: string[];
    /**
     * Optional: where the user manages the operator-issued identity itself.
     * Absent from the Yundera default on purpose — wiring it to dashboardUrl
     * would materialise an Account card that has never rendered.
     */
    accountUrl?: string;
}

/** A domain zone (nsl.sh, inojob.com) and where its own dashboard lives. */
export interface DomainProvider {
    label: string;
    dashboardLabel: string;
    panelLabel: string;
    dashboardUrl: string;
}

export interface BrandIdentity {
    /** Product/brand name interpolated into UI copy. */
    name: string;
    /** Window + login-page title. */
    appTitle: string;
    /**
     * Logo URL. MUST start with `/logo` — serverGate.ts bypasses that prefix,
     * and the login page is unauthenticated, so anything else 302s and renders
     * broken. Enforced by LOGO_PATTERN in loadBrandFile.ts.
     */
    logo: string;
    /** Display name of the PCS log file, e.g. "yundera.log". */
    logFileName: string;
}

/** The on-disk shape of brand.default.json and any brand.json override. */
export interface BrandFile {
    schemaVersion: number;
    brand: BrandIdentity;
    operator: OperatorConfig | null;
    domainProviders: Record<string, DomainProvider>;
}

/** The resolved provider link the UI actually renders. */
export interface ResolvedProvider {
    panelLabel: string;
    dashboardLabel: string;
    dashboardUrl: string;
}

/** What `/api/brand` serves. Contains no secrets and no raw config. */
export interface BrandPayload {
    brand: BrandIdentity;
    hasOperator: boolean;
    support: { enabled: boolean; operatorName: string | null };
    /** null ⇒ hide the provider panel entirely. */
    provider: ResolvedProvider | null;
    /** null ⇒ no operator account card in the Account panel. */
    operatorAccount: { name: string; url: string } | null;
}
