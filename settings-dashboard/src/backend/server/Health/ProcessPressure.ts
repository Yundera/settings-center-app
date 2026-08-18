import { promises as fs } from 'fs';

/**
 * How close this container is to running out of PIDs.
 *
 * This exists because of a real incident, and the shape of that incident is
 * what the checks are aimed at. The admin container reaches the host by
 * spawning `ssh`, and ssh's multiplexing master daemonises through a double
 * fork, orphaning processes onto PID 1. PID 1 was `pnpm` — a Node process,
 * which never reap()s children it did not spawn — so each orphan became a
 * permanent zombie holding a PID. Roughly four PIDs leaked per minute of
 * activity, and six days later the container's 9483-entry pid cgroup was full
 * and every fork() in the container returned EAGAIN.
 *
 * What made it expensive to diagnose was not the leak, it was the silence:
 * nothing reported the PID count, so the first visible symptom was whichever
 * shell-out happened to fail next, complaining about something unrelated. Six
 * days of a monotonically climbing counter went unrecorded.
 *
 * tini as PID 1 (see the Dockerfile ENTRYPOINT) closes that specific hole. This
 * module exists for the next one: any future code path that leaks processes
 * shows up here as a number that climbs, days before it breaks anything.
 *
 * Everything below is plain file reads — deliberately no subprocesses, so it
 * keeps working when the container can no longer fork, which is exactly when
 * its answer matters most.
 */

/** cgroup v2 layout first, then the v1 fallback. */
const PIDS_CURRENT_PATHS = ['/sys/fs/cgroup/pids.current', '/sys/fs/cgroup/pids/pids.current'];
const PIDS_MAX_PATHS = ['/sys/fs/cgroup/pids.max', '/sys/fs/cgroup/pids/pids.max'];

/**
 * Fraction of the pid budget above which we start shouting. A healthy admin
 * container sits near 50 PIDs out of ~9500 (well under 1 %), and nothing it
 * legitimately does — migrations included — approaches a quarter of the
 * budget. Crossing this means something is leaking, not that the box is busy.
 */
const PIDS_WARN_RATIO = 0.25;

/**
 * Zombie count that is a bug on its own terms, independent of the ratio above.
 * A correctly reaped container holds zero; a handful in flight is normal. This
 * catches a leak early even where the pid budget is huge or unlimited, which is
 * the case the ratio check cannot see.
 */
const ZOMBIE_WARN_COUNT = 100;

export type ProcessPressure = {
    /** PIDs currently charged to this container's cgroup, or null if unreadable. */
    pidsCurrent: number | null;
    /** cgroup pid ceiling; null when unreadable or reported as "max" (unlimited). */
    pidsMax: number | null;
    /** Processes in state Z. Non-zero is not automatically wrong; growing is. */
    zombies: number | null;
    /** True once a threshold above is crossed — i.e. this needs a human. */
    warning: boolean;
};

const UNKNOWN_PRESSURE: ProcessPressure = {
    pidsCurrent: null,
    pidsMax: null,
    zombies: null,
    warning: false,
};

async function readFirst(paths: string[]): Promise<string | null> {
    for (const path of paths) {
        try {
            return (await fs.readFile(path, 'utf8')).trim();
        } catch {
            // Try the next layout.
        }
    }
    return null;
}

async function readPidsCurrent(): Promise<number | null> {
    const raw = await readFirst(PIDS_CURRENT_PATHS);
    if (raw === null) return null;
    const value = Number.parseInt(raw, 10);
    return Number.isFinite(value) ? value : null;
}

async function readPidsMax(): Promise<number | null> {
    const raw = await readFirst(PIDS_MAX_PATHS);
    // "max" is cgroup-speak for unlimited — a real state, not a failure, but
    // there is no ratio to compute from it.
    if (raw === null || raw === 'max') return null;
    const value = Number.parseInt(raw, 10);
    return Number.isFinite(value) ? value : null;
}

/**
 * Count processes in state Z.
 *
 * /proc/<pid>/stat is `pid (comm) state …`, and comm is an arbitrary string
 * that may itself contain spaces and parentheses — so the state field is found
 * from the LAST ')' rather than by splitting on whitespace. Processes that exit
 * mid-scan are skipped; a racing read is not an error worth reporting.
 */
async function countZombies(): Promise<number | null> {
    let entries: string[];
    try {
        entries = await fs.readdir('/proc');
    } catch {
        return null;
    }

    let zombies = 0;
    for (const entry of entries) {
        if (!/^\d+$/.test(entry)) continue;
        try {
            const stat = await fs.readFile(`/proc/${entry}/stat`, 'utf8');
            const afterComm = stat.lastIndexOf(')');
            if (afterComm === -1) continue;
            if (stat.slice(afterComm + 1).trim().charAt(0) === 'Z') zombies++;
        } catch {
            // Process exited between readdir and read.
        }
    }
    return zombies;
}

/**
 * Sample the container's process pressure. Never throws — an unreadable
 * counter reports null rather than taking down the health refresh that calls
 * it.
 */
export async function readProcessPressure(): Promise<ProcessPressure> {
    try {
        const [pidsCurrent, pidsMax, zombies] = await Promise.all([
            readPidsCurrent(),
            readPidsMax(),
            countZombies(),
        ]);

        const ratioExceeded =
            pidsCurrent !== null && pidsMax !== null && pidsCurrent >= pidsMax * PIDS_WARN_RATIO;
        const zombiesExceeded = zombies !== null && zombies >= ZOMBIE_WARN_COUNT;

        return {
            pidsCurrent,
            pidsMax,
            zombies,
            warning: ratioExceeded || zombiesExceeded,
        };
    } catch {
        return UNKNOWN_PRESSURE;
    }
}

/**
 * One-line description for the log, written only when something is wrong. The
 * text names fork() explicitly so the next person greps their way to the cause
 * instead of to whichever shell-out failed first.
 */
export function describePressure(pressure: ProcessPressure): string {
    return (
        `Health: container process pressure is abnormal — ` +
        `${pressure.pidsCurrent ?? '?'}/${pressure.pidsMax ?? 'unlimited'} PIDs in use, ` +
        `${pressure.zombies ?? '?'} zombie(s). Something is leaking processes; ` +
        `when the pid cgroup fills, every fork() in this container fails with EAGAIN ` +
        `and host commands start failing for unrelated-looking reasons.`
    );
}
