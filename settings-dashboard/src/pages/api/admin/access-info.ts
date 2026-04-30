import { NextApiRequest, NextApiResponse } from 'next';
import { authMiddleware } from "@/backend/auth/middleware";
import { executeHostCommand } from "@/backend/cmd/HostExecutor";

const ADMIN_KEY_COMMENT = 'local-admin-access';

export interface AuthorizedKey {
    type: string;
    fingerprint: string;
    bits: number | null;
    comment: string;
    isAdminKey: boolean;
}

export interface LoginEvent {
    username: string;
    terminal: string;
    from: string;
    time: string;
    duration: string;
}

export interface HostAccount {
    username: string;
    uid: number;
    gid: number;
    home: string;
    shell: string;
    isSystem: boolean;
    lastLoginTime: string | null;
    lastLoginFrom: string | null;
    authorizedKeys: AuthorizedKey[];
    authorizedKeysError: string | null;
}

export interface AccessInfoResponse {
    accounts: HostAccount[];
    recentLogins: LoginEvent[];
    collectedAt: string;
}

// Per-user authorized_keys files are mode 0600 owned by their respective
// user; the admin SSH session can't read them directly. We sudo each
// file-touching call (test/cat/ssh-keygen) — getent and last only need
// world-readable sources, no elevation needed.
const COLLECT_SCRIPT = `
echo '===PASSWD==='
getent passwd
echo '===LAST==='
last -F -i -w -n 50 2>/dev/null | head -n 50 || true
echo '===KEYS==='
getent passwd | while IFS=: read -r name _ uid _ _ home shell; do
  if [ -z "$home" ] || [ ! -d "$home" ]; then continue; fi
  ak="$home/.ssh/authorized_keys"
  if ! sudo -n test -f "$ak"; then continue; fi
  echo "---USER:$name---"
  echo "FP_START"
  sudo -n ssh-keygen -lf "$ak" 2>/dev/null || true
  echo "FP_END"
  echo "RAW_START"
  sudo -n cat "$ak" 2>/dev/null || true
  echo "RAW_END"
done
echo '===END==='
`.trim();

function parsePasswd(block: string): HostAccount[] {
    const accounts: HostAccount[] = [];
    for (const line of block.split('\n')) {
        if (!line.trim()) continue;
        const parts = line.split(':');
        if (parts.length < 7) continue;
        const [name, , uidStr, gidStr, , home, shell] = parts;
        const uid = parseInt(uidStr, 10);
        const gid = parseInt(gidStr, 10);
        if (Number.isNaN(uid)) continue;
        const noLoginShells = ['/usr/sbin/nologin', '/sbin/nologin', '/bin/false', '/usr/bin/false'];
        const isSystem = uid !== 0 && (uid < 1000 || noLoginShells.includes(shell));
        accounts.push({
            username: name,
            uid,
            gid,
            home,
            shell,
            isSystem,
            lastLoginTime: null,
            lastLoginFrom: null,
            authorizedKeys: [],
            authorizedKeysError: null,
        });
    }
    return accounts;
}

function parseLast(block: string): LoginEvent[] {
    const events: LoginEvent[] = [];
    for (const raw of block.split('\n')) {
        const line = raw.trimEnd();
        if (!line.trim()) continue;
        if (/^wtmp begins/i.test(line)) continue;
        if (/^reboot\s+system/i.test(line)) continue;
        const username = line.slice(0, 8).trim();
        if (!username || username === 'reboot' || username === 'shutdown') continue;
        const terminal = line.slice(9, 21).trim();
        const from = line.slice(22, 38).trim();
        const rest = line.slice(39).trim();
        const dashIdx = rest.indexOf(' - ');
        let time: string;
        let duration: string;
        if (dashIdx >= 0) {
            time = rest.slice(0, dashIdx).trim();
            duration = rest.slice(dashIdx + 3).trim();
        } else {
            time = rest;
            duration = '';
        }
        events.push({ username, terminal, from, time, duration });
    }
    return events;
}

function parseFingerprintLine(line: string): { type: string; fingerprint: string; bits: number | null; comment: string } | null {
    const trimmed = line.trim();
    if (!trimmed) return null;
    const match = trimmed.match(/^(\d+)\s+(\S+)\s+(.*)\s+\(([^)]+)\)\s*$/);
    if (!match) return null;
    const [, bitsStr, fingerprint, comment, type] = match;
    return {
        type,
        fingerprint,
        bits: parseInt(bitsStr, 10) || null,
        comment: comment.trim(),
    };
}

function parseRawKeyLine(line: string): { type: string; comment: string } | null {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return null;
    const parts = trimmed.split(/\s+/);
    if (parts.length < 2) return null;
    const type = parts[0];
    const comment = parts.slice(2).join(' ');
    return { type, comment };
}

function parseKeysSection(block: string): Record<string, { keys: AuthorizedKey[]; error: string | null }> {
    const out: Record<string, { keys: AuthorizedKey[]; error: string | null }> = {};
    const userRe = /^---USER:(.+)---$/;
    const lines = block.split('\n');
    let i = 0;
    while (i < lines.length) {
        const userMatch = lines[i].match(userRe);
        if (!userMatch) { i++; continue; }
        const username = userMatch[1];
        i++;
        const fpLines: string[] = [];
        const rawLines: string[] = [];
        while (i < lines.length && !lines[i].match(userRe)) {
            const line = lines[i];
            if (line === 'FP_START') {
                i++;
                while (i < lines.length && lines[i] !== 'FP_END') { fpLines.push(lines[i]); i++; }
            } else if (line === 'RAW_START') {
                i++;
                while (i < lines.length && lines[i] !== 'RAW_END') { rawLines.push(lines[i]); i++; }
            }
            i++;
        }

        const rawEntries = rawLines.map(parseRawKeyLine).filter(Boolean) as { type: string; comment: string }[];
        const fpEntries = fpLines.map(parseFingerprintLine).filter(Boolean) as { type: string; fingerprint: string; bits: number | null; comment: string }[];

        let keys: AuthorizedKey[];
        if (fpEntries.length === rawEntries.length && fpEntries.length > 0) {
            keys = fpEntries.map((fp, idx) => ({
                type: fp.type,
                fingerprint: fp.fingerprint,
                bits: fp.bits,
                comment: rawEntries[idx]?.comment || fp.comment,
                isAdminKey: (rawEntries[idx]?.comment || fp.comment).includes(ADMIN_KEY_COMMENT),
            }));
        } else {
            keys = rawEntries.map(r => ({
                type: r.type,
                fingerprint: '',
                bits: null,
                comment: r.comment,
                isAdminKey: r.comment.includes(ADMIN_KEY_COMMENT),
            }));
        }

        out[username] = {
            keys,
            error: rawEntries.length === 0 && rawLines.length > 0
                ? 'Could not parse authorized_keys'
                : null,
        };
    }
    return out;
}

function splitSections(stdout: string): Record<string, string> {
    const sections: Record<string, string> = {};
    const markerRe = /^===([A-Z]+)===$/;
    const lines = stdout.split('\n');
    let current: string | null = null;
    let buf: string[] = [];
    for (const line of lines) {
        const m = line.match(markerRe);
        if (m) {
            if (current) sections[current] = buf.join('\n');
            current = m[1];
            buf = [];
        } else if (current) {
            buf.push(line);
        }
    }
    if (current) sections[current] = buf.join('\n');
    return sections;
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const result = await executeHostCommand(COLLECT_SCRIPT);
        const sections = splitSections(result.stdout);

        const accounts = parsePasswd(sections.PASSWD || '');
        const recentLogins = parseLast(sections.LAST || '');
        const keysByUser = parseKeysSection(sections.KEYS || '');

        const seenLastLogin = new Set<string>();
        for (const event of recentLogins) {
            if (seenLastLogin.has(event.username)) continue;
            seenLastLogin.add(event.username);
            const acc = accounts.find(a => a.username === event.username);
            if (acc) {
                acc.lastLoginTime = event.time;
                acc.lastLoginFrom = event.from || event.terminal;
            }
        }

        for (const acc of accounts) {
            const entry = keysByUser[acc.username];
            if (entry) {
                acc.authorizedKeys = entry.keys;
                acc.authorizedKeysError = entry.error;
            }
        }

        const response: AccessInfoResponse = {
            accounts,
            recentLogins,
            collectedAt: new Date().toISOString(),
        };
        res.setHeader('Cache-Control', 'no-store');
        res.status(200).json(response);
    } catch (error) {
        res.status(500).json({
            error: 'Failed to collect access info',
            details: error instanceof Error ? error.message : String(error),
        });
    }
}

export default authMiddleware(handler);
