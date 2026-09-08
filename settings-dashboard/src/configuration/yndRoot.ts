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
