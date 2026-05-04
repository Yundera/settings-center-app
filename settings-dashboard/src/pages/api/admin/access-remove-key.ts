import { NextApiRequest, NextApiResponse } from 'next';
import { authMiddleware } from "@/backend/auth/middleware";
import { executeHostCommand } from "@/backend/cmd/HostExecutor";

const USERNAME_RE = /^[a-z_][a-z0-9_-]{0,31}$/;
// SHA256:<43 url-safe-b64 chars> or MD5:<32 hex pairs colon-separated>
const FINGERPRINT_RE = /^(SHA256:[A-Za-z0-9+/]{43}=*|MD5:(?:[0-9a-f]{2}:){15}[0-9a-f]{2})$/;

async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { username, fingerprint } = (req.body || {}) as { username?: string; fingerprint?: string };
    if (!username || !USERNAME_RE.test(username)) {
        return res.status(400).json({ error: 'Invalid username' });
    }
    if (!fingerprint || !FINGERPRINT_RE.test(fingerprint)) {
        return res.status(400).json({ error: 'Invalid fingerprint' });
    }

    // Same base64-pipe pattern as access-add-key.ts: the script uses $VARS that
    // must expand on the host, not the local container shell, so we hand the
    // entire script to bash as decoded stdin.
    //
    // Strategy: ssh-keygen -lf prints the fingerprint of each key in
    // authorized_keys in order. We pair line N of the file with fingerprint
    // line N, drop the matching one, and rewrite atomically.
    const innerScript = `set -e
HOME_DIR=$(getent passwd '${username}' | cut -d: -f6)
if [ -z "$HOME_DIR" ]; then echo USER_NOT_FOUND; exit 2; fi
AK="$HOME_DIR/.ssh/authorized_keys"
if [ ! -f "$AK" ]; then echo NO_KEYS_FILE; exit 0; fi

TARGET='${fingerprint}'
TMP=$(mktemp)
REMOVED=0

# Walk the file line-by-line. For each non-empty, non-comment line, compute
# its fingerprint via ssh-keygen -lf on a single-line temp file. Skip lines
# whose fingerprint matches TARGET; copy everything else.
while IFS= read -r LINE || [ -n "$LINE" ]; do
  TRIMMED=$(echo "$LINE" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')
  if [ -z "$TRIMMED" ] || [ "\${TRIMMED:0:1}" = "#" ]; then
    printf '%s\\n' "$LINE" >> "$TMP"
    continue
  fi
  ONE=$(mktemp)
  printf '%s\\n' "$LINE" > "$ONE"
  FP=$(sudo -n ssh-keygen -lf "$ONE" 2>/dev/null | awk '{print $2}')
  rm -f "$ONE"
  if [ "$FP" = "$TARGET" ]; then
    REMOVED=$((REMOVED+1))
  else
    printf '%s\\n' "$LINE" >> "$TMP"
  fi
done < <(sudo -n cat "$AK")

if [ "$REMOVED" -eq 0 ]; then
  rm -f "$TMP"
  echo NOT_FOUND
  exit 0
fi

sudo -n cp "$TMP" "$AK"
sudo -n chmod 600 "$AK"
sudo -n chown '${username}:${username}' "$AK" 2>/dev/null || true
rm -f "$TMP"
echo "REMOVED:$REMOVED"
`;
    const scriptB64 = Buffer.from(innerScript, 'utf8').toString('base64');
    const wrapper = `echo ${scriptB64} | base64 -d | sudo -n bash`;

    try {
        const result = await executeHostCommand(wrapper);
        const out = result.stdout || '';
        if (out.includes('USER_NOT_FOUND')) {
            return res.status(404).json({ error: `User '${username}' does not exist` });
        }
        if (out.includes('NO_KEYS_FILE') || out.includes('NOT_FOUND')) {
            return res.status(200).json({ status: 'not-found', removed: 0 });
        }
        const m = out.match(/REMOVED:(\d+)/);
        const removed = m ? parseInt(m[1], 10) : 0;
        res.status(200).json({ status: 'removed', removed });
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        res.status(500).json({ error: 'Failed to remove SSH key', details: message });
    }
}

export default authMiddleware(handler);
