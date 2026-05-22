// Types for the Certificates panel: enumerate every *.sslip.io domain the
// local Caddy/mesh-router serves (from running containers' caddy labels plus
// the root domain) and report, per domain, whether the live TLS certificate
// was issued by Let's Encrypt or by Caddy's internal fallback CA.
//
// Only *.sslip.io domains are covered: per the PCS Caddyfile, sslip.io labels
// get ACME (Let's Encrypt) certs, while gateway ({domain}) and *.nip.io routes
// intentionally use Yundera's internal CA — an LE check does not apply there.

export type CertStatus =
    | 'letsencrypt'   // live cert issued by Let's Encrypt
    | 'fallback'      // live cert issued by Caddy's internal CA (LE not obtained)
    | 'unreachable';  // TLS handshake on :443 produced no certificate

export interface CertRow {
    domain: string;              // e.g. "casaos-1-2-3-4.sslip.io"
    sources: string[];           // container(s) the domain came from, or "(root domain)"
    status: CertStatus;
    issuer: string | null;       // raw issuer DN from the served certificate
    notAfter: string | null;     // raw openssl notAfter date, e.g. "May 21 12:00:00 2026 GMT"
    expiresInDays: number | null;// days until notAfter (negative if expired)
    reason: string | null;       // short human-readable reason there is no LE cert
                                 // (null when status is 'letsencrypt')
    reasonDetail: string | null; // raw Caddy log line backing `reason`, if one was found
}

export interface CertSnapshot {
    certs: CertRow[];
    snapshotAt: string;          // ISO timestamp the snapshot was taken
}
