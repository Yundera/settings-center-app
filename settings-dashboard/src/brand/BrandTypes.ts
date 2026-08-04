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
    /** The operator's own dashboard for this PCS. */
    dashboardUrl: string;
    /** Link text, e.g. "Yundera Dashboard". */
    dashboardLabel: string;
    /**
     * Sidebar label for the operator panel, e.g. "Operator". Configurable so
     * an operator can call it whatever its dashboard actually is; the app
     * makes no assumption about what that dashboard offers.
     */
    panelLabel: string;
    support: {
        enabled: boolean;
        /**
         * Where the Support panel mails reports. SERVER-SIDE ONLY — read from
         * the BrandFile in support-send-report.ts, never copied into
         * BrandPayload: /api/brand is unauthenticated, and a support inbox is
         * not something to publish to anyone who can reach the login page.
         * Optional so an operator block stays valid without it; the SUPPORT_EMAIL
         * env var overrides it, and with neither set the report is refused
         * rather than sent somewhere the operator did not choose.
         */
        email?: string;
    };
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

/** The resolved operator link the Operator panel actually renders. */
export interface ResolvedOperator {
    /** Who runs this box — the operator's name, or the domain zone's label. */
    name: string;
    panelLabel: string;
    dashboardLabel: string;
    dashboardUrl: string;
}

/** What `/api/brand` serves. Contains no secrets and no raw config. */
export interface BrandPayload {
    brand: BrandIdentity;
    /**
     * True only when a CONFIGURED operator is active. Distinct from `operator`
     * below, which also resolves from the domain-zone fallback: an unoperated
     * box on a known zone still gets a link, but nothing is vouched for.
     */
    hasOperator: boolean;
    support: { enabled: boolean; operatorName: string | null };
    /** null ⇒ hide the Operator panel entirely. */
    operator: ResolvedOperator | null;
    /** null ⇒ no operator account card in the Account panel. */
    operatorAccount: { name: string; url: string } | null;
}
