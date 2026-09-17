import path from "path";
import {getConfig} from "@/configuration/getConfigBackend";

/**
 * The Yundera stack's root on the PCS **host** — the directory holding
 * docker-compose.yml, the three env files, `scripts/` and `log/`.
 *
 * ONE READER, because this path is moving. The template is relocating its tree
 * from `/DATA/AppData/casaos/apps/yundera` (nested two levels inside what used
 * to be CasaOS's AppData root) to `/DATA/AppData/yundera`, alongside the
 * runtime state that already lives there — see template-root's
 * `doc/root-migration.md`. Every panel that shells out to the host builds its
 * paths from here, so the move is one env var on the template side and no
 * release of this app: `COMPOSE_FOLDER_PATH` is injected by the `admin` service
 * in template-root's docker-compose.yml and is authoritative.
 *
 * The literal below is the fallback for a host that supplies nothing, which in
 * practice means an older template — so it stays the pre-move layout until no
 * such host exists. Same shape as `operatorApi()` next door: two sources, one
 * value, read through one function so the compatibility window is one edit
 * wide.
 *
 * HOST PATH, NOT A CONTAINER PATH. Nothing here resolves inside this container:
 * these strings are only ever used to build commands for
 * `executeHostCommand()`. The stack directory is bind-mounted at `/app/data`
 * for the few things this app reads directly — see `brand/loadBrandFile.ts`,
 * which documents that distinction and is the one place both appear.
 *
 * THE MIGRATION TARGET SHARES THIS ROOT, which is why the PCS-to-PCS steps
 * use this function for paths on the *other* box too. `Migration/steps/rsync.ts`
 * copies the whole of `/DATA` from source to target, so the target's tree is
 * this tree — layout included. A target on a different layout is not a case
 * that can arise: it has no template of its own until ours lands on it.
 */
const YND_ROOT_LEGACY = "/DATA/AppData/casaos/apps/yundera";

/** Absolute host path of the stack root, without a trailing slash. */
export function yndRoot(): string {
    const configured = getConfig("COMPOSE_FOLDER_PATH");
    return (configured || YND_ROOT_LEGACY).replace(/\/+$/, "");
}

/** `yndRoot()` joined with the given segments, e.g. `yndPath('log/yundera.log')`. */
export function yndPath(...segments: string[]): string {
    return path.join(yndRoot(), ...segments);
}

/**
 * THE SCRIPT TREE IS NO LONGER AT `yndRoot()/scripts`, AND WHERE IT IS DEPENDS
 * ON THE HOST — so it is resolved by the shell, on the box the command runs on,
 * and never baked into a constant here.
 *
 * template-root split the stack into two roots (its `doc/template-subtree.md`,
 * 2026-09-16): state — the env files, `dex/`, `log/`, `docker-compose.yml` —
 * stays at `yndRoot()`, while the script tree moved to `yndRoot()/template/`,
 * so the template's own `rsync --delete` stops pointing at a directory holding
 * the owner's Authelia database. `COMPOSE_FOLDER_PATH` above still points at
 * the state root and is still right; only `scripts/` moved out from under it.
 *
 * BOTH LAYOUTS ARE LIVE, PERMANENTLY:
 *   - a PCS created after the split has ONLY `template/scripts` — `pcs-init.sh`
 *     installs `root/template/` and nothing else, and the compat shim at the
 *     template's `root/scripts/` is "never installed on a box" (its README);
 *   - a PCS that crossed over from the pre-split layout has BOTH, because the
 *     `.always.sh` migration refreshes the legacy tree in place;
 *   - a PCS that never crossed — frozen UPDATE_URL, powered off, old image —
 *     has only the legacy `scripts/`. template-root keeps that escape hatch
 *     open with no expiry date, so this is not a window that closes.
 *
 * Hence a probe rather than a constant, and one evaluated REMOTELY: these
 * strings are shipped to a host and run there (see the HOST PATH note above).
 * The migration steps make that difference load-bearing — they run commands on
 * the TARGET box, whose layout is its own business, not this container's.
 *
 * The cost of getting this wrong is not subtle: every call becomes
 * `env-file-manager.sh: command not found` (exit 127), which is how the demo
 * service and this app both broke on 2026-09-16, and how this app broke once
 * before on the 2026-09-08 root move.
 */
const TEMPLATE_SUBDIR = "template";

/** `[template-layout dir, legacy dir]` for a stack root, as host paths. */
function scriptsDirCandidates(root: string): [string, string] {
    return [path.posix.join(root, TEMPLATE_SUBDIR, "scripts"), path.posix.join(root, "scripts")];
}

/**
 * Shell prelude that defines `$YND_SCRIPTS` on the host running the command.
 * Prepend it and reference `"$YND_SCRIPTS/tools/env-file-manager.sh"`:
 *
 * ```ts
 * executeHostCommand(`${yndScriptsPrelude()}sudo -n "$YND_SCRIPTS/self-check.sh"`)
 * ```
 *
 * Double quotes throughout, deliberately: migration sends commands to the
 * target wrapped in `shq()` (single quotes), and a single quote in here would
 * have to survive that nesting. `$YND_SCRIPTS` is likewise written so the
 * SOURCE shell never expands it — only the shell that finally runs the script.
 */
export function yndScriptsPrelude(root: string = yndRoot()): string {
    const [templateDir, legacyDir] = scriptsDirCandidates(root);
    return `YND_SCRIPTS="${templateDir}"; [ -d "$YND_SCRIPTS" ] || YND_SCRIPTS="${legacyDir}"; `;
}

/**
 * A command whose stdout is the scripts dir on the host that runs it — for the
 * callers that cannot use the prelude because something wraps their whole
 * command (`sudo -n <cmd>`, `shq(<cmd>)`) and would swallow a second statement.
 * One extra round trip, against a step that already costs minutes.
 */
export function yndScriptsDirCommand(root: string = yndRoot()): string {
    const [templateDir, legacyDir] = scriptsDirCandidates(root);
    return `[ -d "${templateDir}" ] && echo "${templateDir}" || echo "${legacyDir}"`;
}
