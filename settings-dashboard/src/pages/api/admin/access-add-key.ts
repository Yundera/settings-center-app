import { NextApiRequest, NextApiResponse } from 'next';
import { adminMiddleware } from "@/backend/auth/middleware";
import { executeHostCommand } from "@/backend/cmd/HostExecutor";

const VALID_KEY_TYPE = /^(ssh-(rsa|dss|ed25519)|ecdsa-sha2-nistp(256|384|521)|sk-(ssh-ed25519|ecdsa-sha2-nistp256)@openssh\.com)$/;
const USERNAME_RE = /^[a-z_][a-z0-9_-]{0,31}$/;

function validatePublicKey(raw: string): { ok: true; line: string } | { ok: false; error: string } {
    const line = raw.replace(/\r/g, '').trim();
    if (!line) return { ok: false, error: 'Public key is empty' };
    if (line.includes('\n')) return { ok: false, error: 'Only a single key may be added at a time' };
    const parts = line.split(/\s+/);
    if (parts.length < 2) return { ok: false, error: 'Public key must have at least <type> <base64>' };
    const [type, b64] = parts;
    if (!VALID_KEY_TYPE.test(type)) return { ok: false, error: `Unsupported key type: ${type}` };
    if (!/^[A-Za-z0-9+/=]+$/.test(b64)) return { ok: false, error: 'Invalid base64 in public key body' };
    return { ok: true, line };
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { username, publicKey } = (req.body || {}) as { username?: string; publicKey?: string };
    if (!username || !USERNAME_RE.test(username)) {
        return res.status(400).json({ error: 'Invalid username' });
    }
    if (typeof publicKey !== 'string') {
        return res.status(400).json({ error: 'publicKey must be a string' });
    }
    const validation = validatePublicKey(publicKey);
    if (!validation.ok) {
        return res.status(400).json({ error: validation.error });
    }

    // The remote script has $VAR / $(...) constructs we need expanded ON THE
    // HOST, but executeHostCommand wraps the command in local double quotes
    // (which would expand them on the admin container first). Encode the
    // whole script as base64 and decode + execute remotely so quoting and
    // expansion are unambiguous.
    const keyB64 = Buffer.from(validation.line, 'utf8').toString('base64');
    const innerScript = `set -e
HOME_DIR=$(getent passwd '${username}' | cut -d: -f6)
if [ -z "$HOME_DIR" ]; then echo USER_NOT_FOUND; exit 2; fi
if [ ! -d "$HOME_DIR" ]; then echo HOME_MISSING; exit 3; fi
SSH_DIR="$HOME_DIR/.ssh"
AK="$SSH_DIR/authorized_keys"
mkdir -p "$SSH_DIR"
chmod 700 "$SSH_DIR"
touch "$AK"
KEY=$(echo '${keyB64}' | base64 -d)
if grep -qxF "$KEY" "$AK" 2>/dev/null; then
  echo ALREADY_PRESENT
else
  printf '%s\\n' "$KEY" >> "$AK"
  echo ADDED
fi
chmod 600 "$AK"
chown -R '${username}:${username}' "$SSH_DIR" 2>/dev/null || true
`;
    const scriptB64 = Buffer.from(innerScript, 'utf8').toString('base64');
    // Targets any host user's home/.ssh and chowns it back to that user, so
    // the script must run as root (the SSH session is the `admin` sudoer).
    const wrapper = `echo ${scriptB64} | base64 -d | sudo -n bash`;

    try {
        const result = await executeHostCommand(wrapper);
        const out = result.stdout || '';
        if (out.includes('USER_NOT_FOUND')) {
            return res.status(404).json({ error: `User '${username}' does not exist` });
        }
        if (out.includes('HOME_MISSING')) {
            return res.status(409).json({ error: `Home directory for '${username}' does not exist` });
        }
        const status = out.includes('ADDED')
            ? 'added'
            : out.includes('ALREADY_PRESENT')
                ? 'already-present'
                : 'unknown';
        res.status(200).json({ status });
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        res.status(500).json({ error: 'Failed to add SSH key', details: message });
    }
}

export default adminMiddleware(handler);
