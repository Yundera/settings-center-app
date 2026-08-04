import { executeHostCommand } from '@/backend/cmd/HostExecutor';
import { getConfig } from '@/configuration/getConfigBackend';
import { CertRow, CertSnapshot, CertStatus } from './CertificatesTypes';

// POSIX single-quoted shell escape — same pattern as MigrationSSH shq.
function shq(s: string): string {
    return `'${s.replace(/'/g, `'\\''`)}'`;
}

// Public IP → dash form used in sslip.io domains (IPv4 dots and IPv6 colons
// both become dashes), matching ${PUBLIC_IP_DASH} in the PCS Caddyfile.
function ipToDash(ip: string): string {
    return ip.replace(/\./g, '-').replace(/:/g, '-');
}

/**
 * Builds a snapshot of every *.sslip.io domain this PCS serves and whether
 * each one currently presents a Let's Encrypt certificate.
 *
 * Enumeration: caddy-docker-proxy routes are driven by `caddy*` labels on
 * running containers, so the running set is exactly what Caddy serves. The
 * root domain ({PUBLIC_IP_DASH}.sslip.io) is declared in the Caddyfile rather
 * than via a label, so it is added separately.
 *
 * Check: a local TLS handshake against 127.0.0.1:443 (Caddy publishes :443 on
 * the host) with the domain as SNI returns exactly the certificate Caddy holds
 * for that vhost. The issuer DN distinguishes Let's Encrypt from the internal
 * fallback CA. Probing loopback rather than the public IP avoids DNS/NAT
 * hairpin concerns and reflects the ground truth of what Caddy has provisioned.
 *
 * Reason: when a domain is not on a Let's Encrypt cert, the most recent
 * certificate-related error line from the Caddy container's own logs is
 * attached so the operator can see *why* ACME issuance did not succeed.
 */
export async function getCertificatesSnapshot(): Promise<CertSnapshot> {
    const publicIp = (getConfig('PUBLIC_IP') || '').trim();
    const rootSslip = publicIp ? `${ipToDash(publicIp)}.sslip.io` : '';

    // base64-encoded by executeHostCommand, so quoting / $ / backticks are safe.
    const script = `
set +e
ROOT_SSLIP=${shq(rootSslip)}
TMP=$(mktemp)
LOGTMP=$(mktemp)

# sslip.io hostnames from the caddy labels of every running container.
for cid in $(docker ps -q 2>/dev/null); do
  cname=$(docker inspect -f '{{.Name}}' "$cid" 2>/dev/null | sed 's#^/##')
  docker inspect -f '{{range $k,$v := .Config.Labels}}{{$k}}={{$v}}{{println}}{{end}}' "$cid" 2>/dev/null | grep -E '^caddy' | grep -oE '[0-9A-Za-z_-]+[.]sslip[.]io' | sort -u | while IFS= read -r d; do [ -n "$d" ] && printf '%s\\t%s\\n' "$cname" "$d" >> "$TMP"; done
done

# Root domain is declared in the Caddyfile, not as a docker label.
if [ -n "$ROOT_SSLIP" ]; then printf '%s\\t%s\\n' "(root domain)" "$ROOT_SSLIP" >> "$TMP"; fi

# Caddy's own logs hold the reason ACME issuance failed. Pre-filter to just the
# certificate-related error lines so the per-domain lookup set stays small.
CADDY=$(docker ps --format '{{.Names}}' 2>/dev/null | grep -E '^mesh-router-caddy$' | head -1)
if [ -z "$CADDY" ]; then CADDY=$(docker ps --format '{{.Names}} {{.Image}}' 2>/dev/null | grep -i caddy | awk '{print $1}' | head -1); fi
if [ -n "$CADDY" ]; then
  docker logs --since 336h "$CADDY" 2>&1 | grep -iE 'certificat|acme|obtain' | grep -iE 'error|fail|could not|unable|rate.?limit|denied|problem|no such host|timeout' | tr '\\t\\r' '  ' > "$LOGTMP"
fi

echo "==PAIRS=="
sort -u "$TMP"

echo "==CERTS=="
cut -f2 "$TMP" | sort -u | while IFS= read -r d; do
  [ -n "$d" ] || continue
  cert=$(echo | timeout 8 openssl s_client -connect 127.0.0.1:443 -servername "$d" 2>/dev/null | openssl x509 -noout -issuer -enddate 2>/dev/null)
  issuer=$(printf '%s\\n' "$cert" | sed -n 's/^issuer=//p' | head -1)
  na=$(printf '%s\\n' "$cert" | sed -n 's/^notAfter=//p' | head -1)
  printf '%s\\t%s\\t%s\\n' "$d" "$issuer" "$na"
done

echo "==REASONS=="
if [ -s "$LOGTMP" ]; then
  cut -f2 "$TMP" | sort -u | while IFS= read -r d; do
    [ -n "$d" ] || continue
    line=$(grep -F "$d" "$LOGTMP" 2>/dev/null | tail -1 | cut -c1-600)
    [ -n "$line" ] && printf '%s\\t%s\\n' "$d" "$line"
  done
fi

rm -f "$TMP" "$LOGTMP"
echo "==END=="
`.trim();

    const { stdout } = await executeHostCommand(script, { timeout: 5 * 60 * 1000 });
    return parseSnapshot(stdout);
}

/**
 * Turns a raw Caddy log line (or its absence) into a short, human-readable
 * reason a domain is not on a Let's Encrypt certificate.
 */
function classifyReason(
    status: CertStatus,
    logLine: string | null,
): { reason: string | null; reasonDetail: string | null } {
    if (status === 'letsencrypt') {
        return { reason: null, reasonDetail: null };
    }

    const detail = logLine && logLine.trim() ? logLine.trim().slice(0, 600) : null;

    if (detail) {
        const l = detail.toLowerCase();
        let reason: string;
        if (/rate.?limit|too many certificates|429/.test(l)) {
            reason = "Let's Encrypt rate limit reached";
        } else if (/no such host|dns problem|nxdomain|could not resolve|name resolution/.test(l)) {
            reason = 'DNS lookup failed for this domain';
        } else if (/timeout|timed out|deadline exceeded/.test(l)) {
            reason = "Connection to Let's Encrypt timed out";
        } else if (/connection refused/.test(l)) {
            reason = 'Connection refused during ACME validation';
        } else if (/unauthorized|incorrect validation|challenge|invalid response|not reachable|connection reset/.test(l)) {
            reason = 'ACME challenge failed - domain not reachable from the internet on port 80/443';
        } else {
            reason = "Let's Encrypt issuance failed - see the Caddy log line for details";
        }
        return { reason, reasonDetail: detail };
    }

    // No backing log line was found.
    if (status === 'unreachable') {
        return {
            reason: 'Caddy returned no certificate on port 443 - it may be down or restarting',
            reasonDetail: null,
        };
    }
    return {
        reason: "Serving the internal fallback CA - no recent Let's Encrypt error found in Caddy's logs",
        reasonDetail: null,
    };
}

function parseSnapshot(stdout: string): CertSnapshot {
    const lines = stdout.split('\n');
    let section: 'pairs' | 'certs' | 'reasons' | null = null;

    // domain -> set of source containers
    const sources = new Map<string, Set<string>>();
    // domain -> { issuer, notAfter }
    const certInfo = new Map<string, { issuer: string; notAfter: string }>();
    // domain -> raw Caddy log line
    const reasonLines = new Map<string, string>();

    for (const raw of lines) {
        const line = raw.replace(/\r$/, '');
        const marker = line.trim();
        if (marker === '==PAIRS==') { section = 'pairs'; continue; }
        if (marker === '==CERTS==') { section = 'certs'; continue; }
        if (marker === '==REASONS==') { section = 'reasons'; continue; }
        if (marker === '==END==') { section = null; continue; }
        if (!marker) continue;

        if (section === 'pairs') {
            const [container, domain] = line.split('\t');
            if (!domain) continue;
            const set = sources.get(domain) ?? new Set<string>();
            if (container) set.add(container);
            sources.set(domain, set);
        } else if (section === 'certs') {
            const [domain, issuer, notAfter] = line.split('\t');
            if (!domain) continue;
            certInfo.set(domain, {
                issuer: (issuer ?? '').trim(),
                notAfter: (notAfter ?? '').trim(),
            });
        } else if (section === 'reasons') {
            // Reason text can contain anything except a tab (squeezed host-side),
            // so split only on the first tab.
            const tab = line.indexOf('\t');
            if (tab < 0) continue;
            const domain = line.slice(0, tab);
            const reason = line.slice(tab + 1).trim();
            if (domain && reason) reasonLines.set(domain, reason);
        }
    }

    const certs: CertRow[] = [];
    for (const domain of sources.keys()) {
        const info = certInfo.get(domain);
        const issuer = info?.issuer || '';
        const notAfter = info?.notAfter || '';

        let status: CertStatus;
        if (!issuer) {
            status = 'unreachable';
        } else if (/let'?s\s*encrypt/i.test(issuer)) {
            status = 'letsencrypt';
        } else {
            status = 'fallback';
        }

        let expiresInDays: number | null = null;
        if (notAfter) {
            const expMs = new Date(notAfter).getTime();
            if (!Number.isNaN(expMs)) {
                expiresInDays = Math.floor((expMs - Date.now()) / 86_400_000);
            }
        }

        const { reason, reasonDetail } = classifyReason(status, reasonLines.get(domain) ?? null);

        certs.push({
            domain,
            sources: Array.from(sources.get(domain) ?? []).sort(),
            status,
            issuer: issuer || null,
            notAfter: notAfter || null,
            expiresInDays,
            reason,
            reasonDetail,
        });
    }

    certs.sort((a, b) => a.domain.localeCompare(b.domain));
    return { certs, snapshotAt: new Date().toISOString() };
}
