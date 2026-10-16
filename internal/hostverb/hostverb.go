// Package hostverb is the whitelist of what this app may run on the host. Each
// verb is a fixed builder: the script is ours or the template's, and every
// caller-supplied value is validated and passed as its own argv element (or on
// stdin), never spliced into shell text.
//
// Verbs run as root in the host's namespaces (internal/hostrun), so v1's
// `sudo -n` prefixes are gone. Paths are HOST paths: the scripts directory
// (config.HostScripts) and the Yundera root as the host sees them.
package hostverb

import (
	"encoding/base64"
	"errors"
	"fmt"
	"path"
	"regexp"
	"strings"
	"time"

	"github.com/yundera/settings-center-app/internal/hostrun"
)

var (
	safePathRe = regexp.MustCompile(`^/[a-zA-Z0-9/_.-]+$`)
	// UsernameRe is the POSIX-ish login shape onboarding.sh and useradd accept.
	UsernameRe = regexp.MustCompile(`^[a-z_][a-z0-9_-]{0,31}$`)
	cronRe     = regexp.MustCompile(`^[0-9*,\-/ ]+$`)
	fpRe       = regexp.MustCompile(`^SHA256:[A-Za-z0-9+/=]{20,100}$`)
	sshKeyRe   = regexp.MustCompile(`^(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp256|ecdsa-sha2-nistp384|ecdsa-sha2-nistp521|sk-ssh-ed25519@openssh\.com) [A-Za-z0-9+/=]{20,1000}( [A-Za-z0-9@._+-]{0,100})?$`)
)

// Paths are the two host paths every verb is built from.
type Paths struct {
	Scripts string // template scripts dir, host view
	Root    string // Yundera root, host view
}

func (p Paths) check() error {
	for _, v := range []string{p.Scripts, p.Root} {
		if !safePathRe.MatchString(v) || path.Clean(v) != v || v == "/" {
			return fmt.Errorf("unsafe host path %q", v)
		}
	}
	return nil
}

func (p Paths) tool(name string) string { return path.Join(p.Scripts, "tools", name) }
func (p Paths) pcsEnv() string          { return path.Join(p.Root, ".pcs.env") }

// SelfCheck starts the template's self-check, detached. Its own flock makes a
// second start a no-op while one runs (the nightly cron, an identity push).
func SelfCheck(p Paths) (hostrun.Spec, error) {
	if err := p.check(); err != nil {
		return hostrun.Spec{}, err
	}
	return hostrun.Spec{Name: "self-check", Argv: []string{"bash", path.Join(p.Scripts, "self-check.sh")}, Detached: true}, nil
}

// SettableKeys are the .pcs.env keys the UI may write, each with its own check.
var SettableKeys = map[string]func(string) error{
	"UPDATE_URL":      checkUpdateURL,
	"SELF_CHECK_CRON": checkCron,
}

func checkUpdateURL(v string) error {
	if len(v) > 2048 {
		return errors.New("update URL is too long")
	}
	if strings.ContainsAny(v, "'\"\r\n\x00`$\\ ") {
		return errors.New("update URL contains characters an env file cannot hold")
	}
	if v == "" || v == "local" {
		return nil
	}
	if !strings.HasPrefix(v, "https://") && !strings.HasPrefix(v, "http://") && !strings.HasPrefix(v, "file://") {
		return errors.New("update URL must be empty, \"local\", or an http(s)/file URL")
	}
	return nil
}

func checkCron(v string) error {
	if v == "disabled" || v == "off" {
		return nil
	}
	if len(v) > 200 || !cronRe.MatchString(v) || len(strings.Fields(v)) != 5 {
		return errors.New(`schedule must be 5 cron fields (e.g. "0 3 * * *"), or "disabled"`)
	}
	return nil
}

// SetEnv writes one whitelisted key into .pcs.env with the template's own
// env-file-manager.sh, which keeps the file's mode and owner.
func SetEnv(p Paths, key, value string) (hostrun.Spec, error) {
	if err := p.check(); err != nil {
		return hostrun.Spec{}, err
	}
	check, ok := SettableKeys[key]
	if !ok {
		return hostrun.Spec{}, fmt.Errorf("%s is not a settable key", key)
	}
	value = strings.TrimSpace(value)
	if err := check(value); err != nil {
		return hostrun.Spec{}, err
	}
	return hostrun.Spec{Name: "env-set", Argv: []string{"bash", p.tool("env-file-manager.sh"), "set", key, value, p.pcsEnv()}, Timeout: time.Minute}, nil
}

// EnsureNightly re-installs the self-check cron entry from SELF_CHECK_CRON.
func EnsureNightly(p Paths) (hostrun.Spec, error) {
	if err := p.check(); err != nil {
		return hostrun.Spec{}, err
	}
	return hostrun.Spec{Name: "ensure-nightly", Argv: []string{"bash", path.Join(p.Scripts, "self-check", "ensure-nightly-self-check.sh")}, Timeout: time.Minute}, nil
}

// FeatureScripts maps a feature id to its template tool. Each answers
// {"id","enabled"} JSON on stdout for status|enable|disable.
var FeatureScripts = map[string]string{
	"yundera-login":    "feature-yundera-login.sh",
	"support-key":      "feature-support-key.sh",
	"platform-updates": "feature-platform-updates.sh",
}

// FeatureIDs is the display order.
var FeatureIDs = []string{"yundera-login", "support-key", "platform-updates"}

func Feature(p Paths, id, action string) (hostrun.Spec, error) {
	if err := p.check(); err != nil {
		return hostrun.Spec{}, err
	}
	script, ok := FeatureScripts[id]
	if !ok {
		return hostrun.Spec{}, fmt.Errorf("unknown feature %q", id)
	}
	switch action {
	case "status", "enable", "disable":
	default:
		return hostrun.Spec{}, fmt.Errorf("unknown feature action %q", action)
	}
	return hostrun.Spec{Name: "feature-" + id, Argv: []string{"bash", p.tool(script), action}, Timeout: 3 * time.Minute}, nil
}

// OnboardingStatus / MarkCompleted / Reset wrap tools/onboarding.sh.
func Onboarding(p Paths, args ...string) (hostrun.Spec, error) {
	if err := p.check(); err != nil {
		return hostrun.Spec{}, err
	}
	switch strings.Join(args, " ") {
	case "status", "mark-completed", "reset --confirm":
	default:
		return hostrun.Spec{}, fmt.Errorf("unsupported onboarding call %q", args)
	}
	return hostrun.Spec{Name: "onboarding-" + args[0], Argv: append([]string{"bash", p.tool("onboarding.sh")}, args...), Timeout: 3 * time.Minute}, nil
}

// OnboardingRun claims the box for username. The password goes on stdin; with
// generate, onboarding.sh mints one and returns it once in its JSON.
func OnboardingRun(p Paths, username, displayname, password string, generate bool) (hostrun.Spec, error) {
	if err := p.check(); err != nil {
		return hostrun.Spec{}, err
	}
	if !UsernameRe.MatchString(username) {
		return hostrun.Spec{}, errors.New("invalid username")
	}
	if err := ValidateDisplayname(displayname); err != nil {
		return hostrun.Spec{}, err
	}
	env := []string{"env", "ONBOARDING_USERNAME=" + username, "ONBOARDING_DISPLAYNAME=" + displayname}
	var stdin []byte
	if generate {
		env = append(env, "ONBOARDING_GENERATE=1")
		stdin = []byte{}
	} else {
		if err := ValidatePassword(password); err != nil {
			return hostrun.Spec{}, err
		}
		stdin = []byte(password + "\n")
	}
	argv := append(env, "bash", p.tool("onboarding.sh"), "run")
	return hostrun.Spec{Name: "onboarding-run", Argv: argv, Stdin: stdin, Timeout: 5 * time.Minute}, nil
}

// ValidatePassword mirrors onboarding.sh's own rules so the UI gets the reason.
func ValidatePassword(pw string) error {
	if pw == "" {
		return errors.New("password is required")
	}
	if len([]rune(pw)) < 8 {
		return errors.New("password must be at least 8 characters")
	}
	if strings.ContainsAny(pw, "\r\n\x00") {
		return errors.New("password must not contain line breaks")
	}
	return nil
}

func ValidateDisplayname(n string) error {
	if strings.TrimSpace(n) == "" {
		return errors.New("display name is required")
	}
	if len([]rune(n)) > 64 {
		return errors.New("display name must be 64 characters or fewer")
	}
	for _, r := range n {
		if r < 0x20 || r == 0x7f {
			return errors.New("display name contains control characters")
		}
	}
	return nil
}

// BackupVerbs are tools/backup.sh's calls. init and recover read the owner's
// backup password on stdin (one line); reset wipes the backup space, so the
// script itself insists on --confirm.
var BackupVerbs = map[string][]string{
	"status":  {"status"},
	"enable":  {"enable"},
	"disable": {"disable"},
	"init":    {"init"},
	"recover": {"recover"},
	"reset":   {"reset", "--confirm"},
}

// BackupTimeouts sit above backup.sh's own limits: Maison's CLI bounds init at
// 4 min and recover at 16 (it pins every snapshot), reset polls the
// orchestrator's wipe for up to ~150 s, enable/disable re-run self-check
// scripts. Everything but status therefore runs as a background job
// (internal/server), never inside one HTTP request.
var BackupTimeouts = map[string]time.Duration{
	"status":  time.Minute,
	"enable":  5 * time.Minute,
	"disable": 5 * time.Minute,
	"init":    6 * time.Minute,
	"recover": 18 * time.Minute,
	"reset":   4 * time.Minute,
}

// Backup wraps tools/backup.sh. password is required for init and recover —
// where it goes on stdin, never in argv — and refused for every other verb.
func Backup(p Paths, verb, password string) (hostrun.Spec, error) {
	if err := p.check(); err != nil {
		return hostrun.Spec{}, err
	}
	args, ok := BackupVerbs[verb]
	if !ok {
		return hostrun.Spec{}, fmt.Errorf("unsupported backup call %q", verb)
	}
	spec := hostrun.Spec{Name: "backup-" + verb, Argv: append([]string{"bash", p.tool("backup.sh")}, args...), Timeout: BackupTimeouts[verb]}
	switch verb {
	case "init", "recover":
		if err := ValidateBackupPassword(password); err != nil {
			return hostrun.Spec{}, err
		}
		spec.Stdin = []byte(password + "\n")
	default:
		if password != "" {
			return hostrun.Spec{}, fmt.Errorf("backup %s takes no password", verb)
		}
	}
	return spec, nil
}

// BackupPasswordMin is Maison's own minimum for an encryption password.
const BackupPasswordMin = 16

// ErrBackupPasswordShort is the one rule the UI explains separately.
var ErrBackupPasswordShort = fmt.Errorf("backup password must be at least %d characters", BackupPasswordMin)

// ValidateBackupPassword mirrors Maison's rules (and keeps the password one
// stdin line).
func ValidateBackupPassword(pw string) error {
	if strings.ContainsAny(pw, "\r\n\x00") {
		return errors.New("backup password must not contain line breaks")
	}
	if len([]rune(pw)) < BackupPasswordMin {
		return ErrBackupPasswordShort
	}
	return nil
}

// ApplyIdentity writes a verified identity bundle. lines is KEY=VALUE text,
// already shape-checked by internal/identity; it goes on stdin only.
func ApplyIdentity(p Paths, lines []byte) (hostrun.Spec, error) {
	if err := p.check(); err != nil {
		return hostrun.Spec{}, err
	}
	return hostrun.Spec{Name: "apply-identity", Argv: []string{"bash", p.tool("apply-identity.sh")}, Stdin: lines, Timeout: time.Minute}, nil
}

// HostAddrs lists the addresses on the host's interfaces (the public IP sits on
// eth0 on Contabo), one per line, CIDR suffix included.
func HostAddrs() hostrun.Spec {
	return hostrun.Spec{Name: "host-addrs", Argv: []string{"sh", "-c", `ip -o addr show | awk '{print $4}'`}, Timeout: 15 * time.Second}
}

// Reboot restarts the host after a short delay, so the API can answer first.
func Reboot() hostrun.Spec {
	return hostrun.Spec{Name: "reboot", Argv: []string{"sh", "-c", "sleep 2; systemctl reboot || /sbin/reboot"}, Detached: true}
}

// ---- support access --------------------------------------------------------
//
// The scripts take their inputs as positional parameters ($1 user, $2 key or
// fingerprint), so nothing caller-supplied is ever part of the script text.

const supportStatusScript = `set -e
HOME_DIR=$(getent passwd "$1" | cut -d: -f6)
[ -z "$HOME_DIR" ] && exit 2
AK="$HOME_DIR/.ssh/authorized_keys"
[ -f "$AK" ] || exit 0
ssh-keygen -lf "$AK" 2>/dev/null | awk '{print $2}'
`

const supportEnableScript = `set -e
HOME_DIR=$(getent passwd "$1" | cut -d: -f6)
[ -z "$HOME_DIR" ] && echo USER_NOT_FOUND && exit 2
[ ! -d "$HOME_DIR" ] && echo HOME_MISSING && exit 3
SSH_DIR="$HOME_DIR/.ssh"
AK="$SSH_DIR/authorized_keys"
mkdir -p "$SSH_DIR"
chmod 700 "$SSH_DIR"
touch "$AK"
KEY=$(printf '%s' "$2" | base64 -d)
if grep -qxF "$KEY" "$AK" 2>/dev/null; then
  echo ALREADY_PRESENT
else
  printf '%s\n' "$KEY" >> "$AK"
  echo ADDED
fi
chmod 600 "$AK"
chown -R "$1:$1" "$SSH_DIR" 2>/dev/null || true
`

const supportDisableScript = `set -e
HOME_DIR=$(getent passwd "$1" | cut -d: -f6)
[ -z "$HOME_DIR" ] && echo USER_NOT_FOUND && exit 2
AK="$HOME_DIR/.ssh/authorized_keys"
[ ! -f "$AK" ] && echo NO_KEYS_FILE && exit 0
TARGET="$2"
TMP=$(mktemp)
REMOVED=0
while IFS= read -r LINE || [ -n "$LINE" ]; do
  TRIMMED=$(echo "$LINE" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')
  if [ -z "$TRIMMED" ] || [ "${TRIMMED:0:1}" = "#" ]; then
    printf '%s\n' "$LINE" >> "$TMP"; continue
  fi
  ONE=$(mktemp); printf '%s\n' "$LINE" > "$ONE"
  FP=$(ssh-keygen -lf "$ONE" 2>/dev/null | awk '{print $2}')
  rm -f "$ONE"
  if [ "$FP" = "$TARGET" ]; then REMOVED=$((REMOVED+1)); else printf '%s\n' "$LINE" >> "$TMP"; fi
done < "$AK"
if [ "$REMOVED" -eq 0 ]; then rm -f "$TMP"; echo NOT_FOUND; exit 0; fi
cp "$TMP" "$AK"
chmod 600 "$AK"
chown "$1:$1" "$AK" 2>/dev/null || true
rm -f "$TMP"
echo "REMOVED:$REMOVED"
`

// SupportStatus lists the fingerprints in user's authorized_keys.
func SupportStatus(user string) (hostrun.Spec, error) {
	if !UsernameRe.MatchString(user) {
		return hostrun.Spec{}, errors.New("invalid username")
	}
	return hostrun.Spec{Name: "support-status", Argv: []string{"bash", "-c", supportStatusScript, "support-status", user}, Timeout: 30 * time.Second}, nil
}

// SupportEnable appends publicKey to user's authorized_keys if absent.
func SupportEnable(user, publicKey string) (hostrun.Spec, error) {
	if !UsernameRe.MatchString(user) {
		return hostrun.Spec{}, errors.New("invalid username")
	}
	publicKey = strings.TrimSpace(publicKey)
	if !sshKeyRe.MatchString(publicKey) {
		return hostrun.Spec{}, errors.New("support key does not look like an SSH public key")
	}
	b64 := base64.StdEncoding.EncodeToString([]byte(publicKey))
	return hostrun.Spec{Name: "support-enable", Argv: []string{"bash", "-c", supportEnableScript, "support-enable", user, b64}, Timeout: 30 * time.Second}, nil
}

// SupportDisable removes every line of user's authorized_keys whose
// fingerprint is fingerprint.
func SupportDisable(user, fingerprint string) (hostrun.Spec, error) {
	if !UsernameRe.MatchString(user) {
		return hostrun.Spec{}, errors.New("invalid username")
	}
	if !fpRe.MatchString(fingerprint) {
		return hostrun.Spec{}, errors.New("support key fingerprint is malformed")
	}
	return hostrun.Spec{Name: "support-disable", Argv: []string{"bash", "-c", supportDisableScript, "support-disable", user, fingerprint}, Timeout: 30 * time.Second}, nil
}

// ---- metrics and bench ------------------------------------------------------

// MetricsScript prints the ===SECTION=== blocks internal/metrics parses.
const MetricsScript = `
echo "===UPTIME==="
cat /proc/uptime
echo "===LOADAVG==="
cat /proc/loadavg
echo "===NPROC==="
nproc
echo "===MEMINFO==="
grep -E "^(MemTotal|MemFree|MemAvailable|Buffers|Cached|SwapTotal|SwapFree):" /proc/meminfo
echo "===STAT==="
head -1 /proc/stat
echo "===DISKSTATS==="
cat /proc/diskstats
echo "===NETDEV==="
cat /proc/net/dev
echo "===DF==="
df -B1 -x tmpfs -x devtmpfs -x overlay -x squashfs --output=source,target,size,used,avail
`

func Metrics() hostrun.Spec {
	return hostrun.Spec{Name: "metrics", Argv: []string{"sh", "-c", MetricsScript}, Timeout: 15 * time.Second}
}

// BenchDiskTarget is the scratch file the disk bench writes and removes.
const BenchDiskTarget = "/DATA/.bench.tmp"

// BenchDiskMB is the bench size.
const BenchDiskMB = 256

const benchDiskScript = `
set -u
BENCH_FILE=/DATA/.bench.tmp
trap 'rm -f "$BENCH_FILE"' EXIT
echo "===WRITE==="
dd if=/dev/zero of="$BENCH_FILE" bs=1M count=256 oflag=direct conv=fdatasync 2>&1
echo "===READ==="
dd if="$BENCH_FILE" of=/dev/null bs=1M iflag=direct 2>&1
echo "===END==="
`

func BenchDisk() hostrun.Spec {
	return hostrun.Spec{Name: "bench-disk", Argv: []string{"bash", "-c", benchDiskScript}, Timeout: 90 * time.Second}
}

// BenchNetTarget is the speed test endpoint; BenchNetBytes the transfer size.
const (
	BenchNetTarget = "https://speed.cloudflare.com"
	BenchNetBytes  = 25 * 1024 * 1024
)

func BenchNetDown() hostrun.Spec {
	cmd := fmt.Sprintf(`curl -fsS -o /dev/null -w '%%{time_total} %%{speed_download}' --max-time 60 '%s/__down?bytes=%d'`, BenchNetTarget, BenchNetBytes)
	return hostrun.Spec{Name: "bench-net-down", Argv: []string{"sh", "-c", cmd}, Timeout: 75 * time.Second}
}

func BenchNetUp() hostrun.Spec {
	cmd := fmt.Sprintf(`head -c %d /dev/urandom | curl -fsS -o /dev/null -w '%%{time_total} %%{speed_upload}' --max-time 60 -X POST --data-binary @- -H 'Content-Type: application/octet-stream' '%s/__up'`, BenchNetBytes, BenchNetTarget)
	return hostrun.Spec{Name: "bench-net-up", Argv: []string{"sh", "-c", cmd}, Timeout: 75 * time.Second}
}
