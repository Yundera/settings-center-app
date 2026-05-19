import { executeHostCommand } from '@/backend/cmd/HostExecutor';
import {
    AppAction,
    AppActionRequest,
    AppActionState,
    AppBackup,
    AppRow,
    AppState,
    AppsListResult,
    IssueRow,
} from './AppsTypes';

const SYSTEM_STACK = 'yundera';
const INSTALLED_DIR = '/DATA/AppData/casaos/apps';
const APPDATA = '/DATA/AppData';

// Entries that live at /DATA/AppData root but are not user apps and must
// never be touched by this panel.
const SYSTEM_ENTRIES = new Set([
    'casaos',   // CasaOS state (contains the apps/ dir itself)
    'pgdata',   // shared postgres data
    'samba',    // smb config
    'data',     // ambiguous shared data dir
    'Nginx',    // observed leftover (capital N — empty/legacy)
]);

const APP_NAME_RE = /^[a-zA-Z0-9._-]+$/;
const BACKUP_RE = /^([a-zA-Z0-9._-]+)_(\d{8})_(\d{6})\.zip$/;

function validateName(name: string): void {
    if (!APP_NAME_RE.test(name)) throw new Error(`Invalid name: ${name}`);
    if (name.includes('..')) throw new Error(`Invalid name: ${name}`);
}

function validateAppName(name: string): void {
    validateName(name);
    if (name === SYSTEM_STACK) throw new Error(`Cannot operate on system stack: ${name}`);
}

function validateBackupFilename(name: string): void {
    if (!BACKUP_RE.test(name)) throw new Error(`Invalid backup filename: ${name}`);
}

// --------------------------------------------------------------------------
// Snapshot
// --------------------------------------------------------------------------

interface RawInstalled { name: string; compose: string }
interface RawComposeProject { Name: string; Status: string; ConfigFiles: string }
interface RawEntry { name: string; type: 'dir' | 'file' | 'other'; size: number; isEmpty?: boolean }

export async function getAppsSnapshot(): Promise<AppsListResult> {
    // One bash script that emits sectioned JSONL output. We parse on Node side.
    // base64-encoded by executeHostCommand, so quoting / $ / backticks are safe.
    const script = `
set +e
INSTALLED_DIR=${shq(INSTALLED_DIR)}
APPDATA=${shq(APPDATA)}

# Disk usage of /DATA
df_line=$(df -B1 "$APPDATA" 2>/dev/null | tail -n1)
disk_total=$(echo "$df_line" | awk '{print $2}')
disk_free=$(echo "$df_line" | awk '{print $4}')
echo "==DISK=="
printf '{"total":%s,"free":%s}\\n' "\${disk_total:-0}" "\${disk_free:-0}"

echo "==INSTALLED=="
if [ -d "$INSTALLED_DIR" ]; then
  for d in "$INSTALLED_DIR"/*/; do
    [ -d "$d" ] || continue
    name=$(basename "$d")
    compose=""
    for f in docker-compose.yml compose.yml docker-compose.yaml; do
      if [ -f "$d/$f" ]; then compose="$d$f"; break; fi
    done
    # Escape backslashes and double quotes in compose path (paranoia)
    name_esc=$(printf '%s' "$name" | sed 's/\\\\/\\\\\\\\/g; s/"/\\\\"/g')
    compose_esc=$(printf '%s' "$compose" | sed 's/\\\\/\\\\\\\\/g; s/"/\\\\"/g')
    printf '{"name":"%s","compose":"%s"}\\n' "$name_esc" "$compose_esc"
  done
fi

echo "==COMPOSE=="
sudo -n docker compose ls --all --format json 2>/dev/null || echo "[]"

echo "==ENTRIES=="
if [ -d "$APPDATA" ]; then
  for entry in "$APPDATA"/*; do
    [ -e "$entry" ] || continue
    name=$(basename "$entry")
    name_esc=$(printf '%s' "$name" | sed 's/\\\\/\\\\\\\\/g; s/"/\\\\"/g')
    if [ -d "$entry" ]; then
      if [ -z "$(sudo -n ls -A "$entry" 2>/dev/null)" ]; then
        printf '{"name":"%s","type":"dir","size":0,"isEmpty":true}\\n' "$name_esc"
      else
        size=$(sudo -n du -sb "$entry" 2>/dev/null | awk '{print $1}')
        printf '{"name":"%s","type":"dir","size":%s,"isEmpty":false}\\n' "$name_esc" "\${size:-0}"
      fi
    elif [ -f "$entry" ]; then
      size=$(stat -c%s "$entry" 2>/dev/null)
      printf '{"name":"%s","type":"file","size":%s}\\n' "$name_esc" "\${size:-0}"
    else
      printf '{"name":"%s","type":"other","size":0}\\n' "$name_esc"
    fi
  done
fi

echo "==END=="
`.trim();

    const { stdout } = await executeHostCommand(script, { timeout: 5 * 60 * 1000 });
    return parseSnapshot(stdout);
}

function parseSnapshot(stdout: string): AppsListResult {
    const lines = stdout.split('\n');
    let section: 'disk' | 'installed' | 'compose' | 'entries' | null = null;
    let disk = { total: 0, free: 0 };
    const installed: RawInstalled[] = [];
    const entries: RawEntry[] = [];
    let composeRaw = '';

    for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line) continue;
        if (line === '==DISK==') { section = 'disk'; continue; }
        if (line === '==INSTALLED==') { section = 'installed'; continue; }
        if (line === '==COMPOSE==') { section = 'compose'; continue; }
        if (line === '==ENTRIES==') { section = 'entries'; continue; }
        if (line === '==END==') { section = null; continue; }

        try {
            if (section === 'disk') {
                disk = JSON.parse(line);
            } else if (section === 'installed') {
                const obj = JSON.parse(line);
                if (obj?.name) installed.push(obj);
            } else if (section === 'compose') {
                // Buffer; parsed as one JSON array below.
                composeRaw += line;
            } else if (section === 'entries') {
                const obj = JSON.parse(line);
                if (obj?.name) entries.push(obj);
            }
        } catch {
            // Skip malformed lines (e.g. permission denied warnings on stderr
            // that ended up mixed in). Snapshot is best-effort.
        }
    }

    let composeProjects: RawComposeProject[] = [];
    if (composeRaw) {
        try {
            const parsed = JSON.parse(composeRaw);
            if (Array.isArray(parsed)) composeProjects = parsed;
        } catch {
            composeProjects = [];
        }
    }

    return reconcile(disk, installed, composeProjects, entries);
}

function reconcile(
    disk: { total: number; free: number },
    installed: RawInstalled[],
    composeProjects: RawComposeProject[],
    entries: RawEntry[],
): AppsListResult {
    // Index running stacks by compose file path. ConfigFiles can be a
    // comma-separated list; treat any match as "running".
    const runningByPath = new Map<string, boolean>();
    for (const proj of composeProjects) {
        if (!proj?.ConfigFiles || !proj?.Status) continue;
        const isRunning = /^running/i.test(proj.Status);
        for (const path of proj.ConfigFiles.split(',').map(p => p.trim())) {
            if (path) runningByPath.set(path, isRunning);
        }
    }

    // Index entries by name. Filter system entries out of the user-app view.
    const dataByName = new Map<string, RawEntry>();
    const backupsByApp = new Map<string, AppBackup[]>();
    const issues: IssueRow[] = [];

    for (const e of entries) {
        if (SYSTEM_ENTRIES.has(e.name)) continue;
        if (e.type === 'dir') {
            // Skip dirs that match an installed app under casaos/apps but
            // also exist as a data folder — same name, expected.
            dataByName.set(e.name, e);
        } else if (e.type === 'file') {
            const m = BACKUP_RE.exec(e.name);
            if (m) {
                const app = m[1];
                const ts = `${m[2]}T${m[3]}`;
                const list = backupsByApp.get(app) ?? [];
                list.push({ filename: e.name, timestamp: ts, size: e.size });
                backupsByApp.set(app, list);
            } else {
                issues.push({ name: e.name, kind: 'stray-file', path: `${APPDATA}/${e.name}`, size: e.size });
            }
        }
    }

    // Sort backups newest-first per app
    for (const list of backupsByApp.values()) {
        list.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    }

    const apps: AppRow[] = [];
    const seenAppNames = new Set<string>();

    // Pass 1: installed apps
    for (const inst of installed) {
        if (inst.name === SYSTEM_STACK) continue;
        seenAppNames.add(inst.name);
        const data = dataByName.get(inst.name);
        const backups = backupsByApp.get(inst.name) ?? [];
        const hasCompose = !!inst.compose;
        const running = hasCompose ? !!runningByPath.get(inst.compose) : false;

        let state: AppState;
        let error: string | undefined;
        if (!hasCompose) {
            state = 'broken';
            error = `No docker-compose file under ${INSTALLED_DIR}/${inst.name}/`;
        } else {
            state = running ? 'live' : 'down';
        }

        apps.push({
            name: inst.name,
            state,
            installed: true,
            running,
            composePath: hasCompose ? inst.compose : undefined,
            dataPath: data ? `${APPDATA}/${inst.name}` : undefined,
            dataSize: data?.size,
            backups,
            error,
        });
    }

    // Pass 2: apps known only via data folder and/or backup zip
    const candidateNames = new Set<string>([
        ...Array.from(dataByName.keys()),
        ...Array.from(backupsByApp.keys()),
    ]);

    for (const name of candidateNames) {
        if (seenAppNames.has(name)) continue;
        if (name === SYSTEM_STACK) continue;

        const data = dataByName.get(name);
        const backups = backupsByApp.get(name) ?? [];

        let state: AppState;
        let error: string | undefined;
        if (data && data.isEmpty) {
            state = 'empty-folder';
            error = 'Folder exists under /DATA/AppData but is empty';
        } else if (data && backups.length > 0) {
            state = 'backup-and-data';
        } else if (data) {
            state = 'orphan-data';
        } else {
            state = 'backup-only';
        }

        apps.push({
            name,
            state,
            installed: false,
            running: false,
            dataPath: data ? `${APPDATA}/${name}` : undefined,
            dataSize: data?.size,
            backups,
            error,
        });
    }

    apps.sort((a, b) => a.name.localeCompare(b.name));
    issues.sort((a, b) => a.name.localeCompare(b.name));

    return {
        apps,
        issues,
        disk,
        snapshotAt: new Date().toISOString(),
    };
}

// --------------------------------------------------------------------------
// Actions
// --------------------------------------------------------------------------

// In-memory per-app state. Doubles as a mutex: an entry with state==='running'
// blocks new actions on the same app. Survives only as long as the Next.js
// process — that's fine, actions are short-lived from the user's perspective
// and the underlying host command keeps running even if state is lost.
const actionStates = new Map<string, AppActionState>();

export function getActionState(app: string): AppActionState | null {
    return actionStates.get(app) ?? null;
}

export function startAction(req: AppActionRequest): AppActionState {
    // delete-stray uses the file/dir name in `app`. Other actions require a
    // real app name (so the yundera system stack is protected).
    if (req.action === 'delete-stray') {
        validateName(req.app);
    } else {
        validateAppName(req.app);
    }
    if (req.backup) validateBackupFilename(req.backup);

    const existing = actionStates.get(req.app);
    if (existing?.state === 'running') {
        throw new Error(`Action already in progress for ${req.app}: ${existing.action}`);
    }

    const state: AppActionState = {
        app: req.app,
        action: req.action,
        state: 'running',
        startedAt: new Date().toISOString(),
        output: '',
    };
    actionStates.set(req.app, state);

    runAction(req).then(output => {
        actionStates.set(req.app, {
            ...state,
            state: 'done',
            finishedAt: new Date().toISOString(),
            output: trimOutput(output),
        });
    }).catch(err => {
        actionStates.set(req.app, {
            ...state,
            state: 'failed',
            finishedAt: new Date().toISOString(),
            output: trimOutput(err?.partialOutput ?? ''),
            error: err?.message || String(err),
        });
    });

    return state;
}

function trimOutput(out: string): string {
    // Keep last 50 KB — enough for diagnostics, won't blow up memory.
    const MAX = 50_000;
    if (out.length <= MAX) return out;
    return '…(truncated)…\n' + out.slice(-MAX);
}

async function runAction(req: AppActionRequest): Promise<string> {
    const ts = formatTimestamp(new Date());
    const app = req.app;
    const composeFile = `${INSTALLED_DIR}/${app}/docker-compose.yml`;
    const dataPath = `${APPDATA}/${app}`;

    switch (req.action) {
        case 'up':
            return runHost(
                `sudo -n docker compose -f ${shq(composeFile)} up -d 2>&1`,
                10 * 60_000,
            );

        case 'down':
            return runHost(
                `sudo -n docker compose -f ${shq(composeFile)} down --remove-orphans 2>&1`,
                5 * 60_000,
            );

        case 'backup':
            return runHost(backupScript(app, ts), 30 * 60_000);

        case 'down-and-backup': {
            const a = await runHost(
                `sudo -n docker compose -f ${shq(composeFile)} down --remove-orphans 2>&1`,
                5 * 60_000,
            );
            const b = await runHost(backupScript(app, ts), 30 * 60_000);
            return a + '\n---\n' + b;
        }

        case 'restore':
        case 'restore-and-up': {
            if (!req.backup) throw new Error('backup filename required for restore');
            const zipPath = `${APPDATA}/${req.backup}`;
            const parts: string[] = [];

            // If data exists & non-empty, snapshot it before overwriting.
            const probe = await runHost(
                `if sudo -n test -d ${shq(dataPath)} && [ -n "$(sudo -n ls -A ${shq(dataPath)} 2>/dev/null)" ]; then echo NON_EMPTY; else echo EMPTY; fi`,
                30_000,
            );
            if (probe.includes('NON_EMPTY')) {
                parts.push('# Safety backup of existing data');
                parts.push(await runHost(backupScript(app, `${ts}_pre_restore`), 30 * 60_000));
                parts.push(`# Removing old data folder`);
                parts.push(await runHost(`sudo -n rm -rf ${shq(dataPath)}`, 60_000));
            }

            parts.push(`# Restoring ${req.backup}`);
            parts.push(await runHost(
                `cd ${shq(APPDATA)} && sudo -n unzip -o ${shq(zipPath)} 2>&1 | tail -50`,
                30 * 60_000,
            ));

            if (req.action === 'restore-and-up') {
                // Only attempt 'up' if the install dir exists (post-restore the
                // app must already be installed in casaos/apps/).
                const hasCompose = await runHost(
                    `sudo -n test -f ${shq(composeFile)} && echo YES || echo NO`,
                    30_000,
                );
                if (hasCompose.includes('YES')) {
                    parts.push(`# Bringing app up`);
                    parts.push(await runHost(
                        `sudo -n docker compose -f ${shq(composeFile)} up -d 2>&1`,
                        10 * 60_000,
                    ));
                } else {
                    parts.push(`# Skipping 'up': no compose file under ${INSTALLED_DIR}/${app}/`);
                }
            }
            return parts.join('\n');
        }

        case 'uninstall': {
            const parts: string[] = [];
            parts.push(await runHost(
                `if sudo -n test -f ${shq(composeFile)}; then sudo -n docker compose -f ${shq(composeFile)} down --remove-orphans 2>&1; else echo "(no compose file)"; fi`,
                5 * 60_000,
            ));
            parts.push(await runHost(
                `sudo -n rm -rf ${shq(`${INSTALLED_DIR}/${app}`)}`,
                60_000,
            ));
            if (req.alsoDeleteData) {
                parts.push(await runHost(
                    `sudo -n rm -rf ${shq(dataPath)}`,
                    5 * 60_000,
                ));
            }
            return parts.join('\n---\n');
        }

        case 'delete-backup': {
            if (!req.backup) throw new Error('backup filename required');
            return runHost(
                `sudo -n rm -f ${shq(`${APPDATA}/${req.backup}`)}`,
                30_000,
            );
        }

        case 'delete-data':
            return runHost(`sudo -n rm -rf ${shq(dataPath)}`, 5 * 60_000);

        case 'delete-stray':
            // `app` is the stray filename; validated above.
            return runHost(`sudo -n rm -rf ${shq(`${APPDATA}/${app}`)}`, 60_000);

        default: {
            const _exhaustive: never = req.action;
            throw new Error(`Unknown action: ${_exhaustive}`);
        }
    }
}

function backupScript(app: string, ts: string): string {
    // `cd /DATA/AppData && zip -r <app>_<ts>.zip <app>` so the zip contains
    // entries rooted at `<app>/...` (matches the existing CasaOS convention
    // visible in the user's listing).
    return `cd ${shq(APPDATA)} && sudo -n zip -r ${shq(`${app}_${ts}.zip`)} ${shq(app)} 2>&1 | tail -50`;
}

async function runHost(cmd: string, timeout: number): Promise<string> {
    try {
        const r = await executeHostCommand(cmd, { timeout });
        return (r.stdout || '') + (r.stderr ? `\n[stderr]\n${r.stderr}` : '');
    } catch (err: any) {
        // Bubble up with the message; caller records as failure state.
        throw new Error(err?.message || String(err));
    }
}

function formatTimestamp(d: Date): string {
    const z = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}${z(d.getMonth() + 1)}${z(d.getDate())}_${z(d.getHours())}${z(d.getMinutes())}${z(d.getSeconds())}`;
}

// POSIX single-quoted shell escape — copy of the pattern used in
// MigrationSSH/shq. Wraps the arg in '...' and escapes any embedded '.
function shq(s: string): string {
    return `'${s.replace(/'/g, `'\\''`)}'`;
}
