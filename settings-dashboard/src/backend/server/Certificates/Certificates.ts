import { executeHostCommand } from '@/backend/cmd/HostExecutor';
import { getConfig } from '@/configuration/getConfigBackend';
import { CertRow, CertSnapshot, CertStatus } from './CertificatesTypes';

// POSIX single-quoted shell escape — same pattern as Apps.ts/MigrationSSH shq.
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
 */
export async function getCertificatesSnapshot(): Promise<CertSnapshot> {
    const publicIp = (getConfig('PUBLIC_IP') || '').trim();
    const rootSslip = publicIp ? `${ipToDash(publicIp)}.sslip.io` : '';

    // base64-encoded by executeHostCommand, so quoting / $ / backticks are safe.
    const script = `
set +e
ROOT_SSLIP=${shq(rootSslip)}
TMP=$(mktemp)

# sslip.io hostnames from the caddy labels of every running container.
for cid in $(docker ps -q 2>/dev/null); do
  cname=$(docker inspect -f '{{.Name}}' "$cid" 2>/dev/null | sed 's#^/##')
  docker inspect -f '{{range $k,$v := .Config.Labels}}{{$k}}={{$v}}{{println}}{{end}}' "$cid" 2>/dev/null | grep -E '^caddy' | grep -oE '[0-9A-Za-z_-]+[.]sslip[.]io' | sort -u | while IFS= read -r d; do [ -n "$d" ] && printf '%s\\t%s\\n' "$cname" "$d" >> "$TMP"; done
done

# Root domain is declared in the Caddyfile, not as a docker label.
if [ -n "$ROOT_SSLIP" ]; then printf '%s\\t%s\\n' "(root domain)" "$ROOT_SSLIP" >> "$TMP"; fi

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

rm -f "$TMP"
echo "==END=="
`.trim();

    const { stdout } = await executeHostCommand(script, { timeout: 5 * 60 * 1000 });
    return parseSnapshot(stdout);
}

function parseSnapshot(stdout: string): CertSnapshot {
    const lines = stdout.split('\n');
    let section: 'pairs' | 'certs' | null = null;

    // domain -> set of source containers
    const sources = new Map<string, Set<string>>();
    // domain -> { issuer, notAfter }
    const certInfo = new Map<string, { issuer: string; notAfter: string }>();

    for (const raw of lines) {
        const line = raw.replace(/\r$/, '');
        const marker = line.trim();
        if (marker === '==PAIRS==') { section = 'pairs'; continue; }
        if (marker === '==CERTS==') { section = 'certs'; continue; }
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

        certs.push({
            domain,
            sources: Array.from(sources.get(domain) ?? []).sort(),
            status,
            issuer: issuer || null,
            notAfter: notAfter || null,
            expiresInDays,
        });
    }

    certs.sort((a, b) => a.domain.localeCompare(b.domain));
    return { certs, snapshotAt: new Date().toISOString() };
}
