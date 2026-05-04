import { executeHostCommand } from "@/backend/cmd/HostExecutor";
import { defaultHostUser } from "@/backend/cmd/HostExecutor";
import { fetchSupportKey, SupportKey } from "./SupportKey";

const USERNAME_RE = /^[a-z_][a-z0-9_-]{0,31}$/;

export interface SupportAccessStatus {
    enabled: boolean;
    username: string;
    fingerprint: string;
    comment: string;
}

/**
 * Returns whether the orchestrator's support key is currently authorized to
 * SSH into the given host user (default: the admin sudoer).
 */
export async function getSupportAccessStatus(username: string = defaultHostUser): Promise<SupportAccessStatus> {
    if (!USERNAME_RE.test(username)) {
        throw new Error('Invalid username');
    }
    const key = await fetchSupportKey();

    // Read the user's authorized_keys via sudo and ssh-keygen -lf to get
    // fingerprints. If the file doesn't exist, the key isn't there — return
    // disabled rather than erroring.
    const script = `set -e
HOME_DIR=$(getent passwd '${username}' | cut -d: -f6)
[ -z "$HOME_DIR" ] && exit 2
AK="$HOME_DIR/.ssh/authorized_keys"
sudo -n test -f "$AK" || exit 0
sudo -n ssh-keygen -lf "$AK" 2>/dev/null | awk '{print $2}'
`;
    const b64 = Buffer.from(script, 'utf8').toString('base64');
    const result = await executeHostCommand(`echo ${b64} | base64 -d | sudo -n bash`);
    const fingerprints = (result.stdout || '').split('\n').map(s => s.trim()).filter(Boolean);
    return {
        enabled: fingerprints.includes(key.fingerprint),
        username,
        fingerprint: key.fingerprint,
        comment: key.comment,
    };
}

/**
 * Adds the orchestrator's support key to the host user's authorized_keys.
 * No-op (returns "already-present") if it's already there.
 */
export async function enableSupportAccess(username: string = defaultHostUser): Promise<{ status: 'added' | 'already-present'; key: SupportKey }> {
    if (!USERNAME_RE.test(username)) throw new Error('Invalid username');
    const key = await fetchSupportKey();

    const keyB64 = Buffer.from(key.publicKey, 'utf8').toString('base64');
    const script = `set -e
HOME_DIR=$(getent passwd '${username}' | cut -d: -f6)
[ -z "$HOME_DIR" ] && echo USER_NOT_FOUND && exit 2
[ ! -d "$HOME_DIR" ] && echo HOME_MISSING && exit 3
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
    const b64 = Buffer.from(script, 'utf8').toString('base64');
    const result = await executeHostCommand(`echo ${b64} | base64 -d | sudo -n bash`);
    const out = result.stdout || '';
    if (out.includes('USER_NOT_FOUND')) throw new Error(`User '${username}' does not exist`);
    if (out.includes('HOME_MISSING')) throw new Error(`Home directory for '${username}' does not exist`);
    return { status: out.includes('ADDED') ? 'added' : 'already-present', key };
}

/**
 * Removes the orchestrator's support key (matched by fingerprint) from the
 * host user's authorized_keys.
 */
export async function disableSupportAccess(username: string = defaultHostUser): Promise<{ status: 'removed' | 'not-found'; removed: number; key: SupportKey }> {
    if (!USERNAME_RE.test(username)) throw new Error('Invalid username');
    const key = await fetchSupportKey();

    // Same line-by-line filter as access-remove-key. Kept inline (rather than
    // calling the HTTP endpoint) so this is callable from server code with
    // direct error propagation.
    const script = `set -e
HOME_DIR=$(getent passwd '${username}' | cut -d: -f6)
[ -z "$HOME_DIR" ] && echo USER_NOT_FOUND && exit 2
AK="$HOME_DIR/.ssh/authorized_keys"
[ ! -f "$AK" ] && echo NO_KEYS_FILE && exit 0
TARGET='${key.fingerprint}'
TMP=$(mktemp)
REMOVED=0
while IFS= read -r LINE || [ -n "$LINE" ]; do
  TRIMMED=$(echo "$LINE" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')
  if [ -z "$TRIMMED" ] || [ "\${TRIMMED:0:1}" = "#" ]; then
    printf '%s\\n' "$LINE" >> "$TMP"; continue
  fi
  ONE=$(mktemp); printf '%s\\n' "$LINE" > "$ONE"
  FP=$(sudo -n ssh-keygen -lf "$ONE" 2>/dev/null | awk '{print $2}')
  rm -f "$ONE"
  if [ "$FP" = "$TARGET" ]; then REMOVED=$((REMOVED+1)); else printf '%s\\n' "$LINE" >> "$TMP"; fi
done < <(sudo -n cat "$AK")
if [ "$REMOVED" -eq 0 ]; then rm -f "$TMP"; echo NOT_FOUND; exit 0; fi
sudo -n cp "$TMP" "$AK"
sudo -n chmod 600 "$AK"
sudo -n chown '${username}:${username}' "$AK" 2>/dev/null || true
rm -f "$TMP"
echo "REMOVED:$REMOVED"
`;
    const b64 = Buffer.from(script, 'utf8').toString('base64');
    const result = await executeHostCommand(`echo ${b64} | base64 -d | sudo -n bash`);
    const out = result.stdout || '';
    if (out.includes('USER_NOT_FOUND')) throw new Error(`User '${username}' does not exist`);
    if (out.includes('NO_KEYS_FILE') || out.includes('NOT_FOUND')) {
        return { status: 'not-found', removed: 0, key };
    }
    const m = out.match(/REMOVED:(\d+)/);
    return { status: 'removed', removed: m ? parseInt(m[1], 10) : 0, key };
}
