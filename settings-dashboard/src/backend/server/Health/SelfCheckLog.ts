/**
 * Parser for the self-check trail in yundera.log.
 *
 * The host is the source of truth: self-check.sh brackets each run with
 *
 *   [ts] [INFO] === Self-check starting ===
 *   ...
 *   [ts] [INFO] === Self-check completed successfully ===   (or "with failures")
 *
 * and library/log.sh's execute_script_with_logging brackets each ensure-script
 * inside that window with an exact triple:
 *
 *   [ts] [INFO]    === [datetime] ensure-foo.sh : starting ===
 *   [ts] [OUTPUT]  <one line of the script's stdout/stderr>
 *   [ts] [SUCCESS] === [datetime] ensure-foo.sh : success (2s) ===
 *   [ts] [ERROR]   === [datetime] ensure-bar.sh : failed (exit code: 1, 3s) ===
 *
 * Everything here is a pure function over the log text — no SSH, no I/O — so
 * both the public /api/health snapshot and the admin summary endpoint read the
 * same structure and cannot drift apart.
 */

export type ScriptStatus = "success" | "failed" | "running";

export interface ScriptResult {
    name: string;
    status: ScriptStatus;
    /** Wall time reported by the host, seconds. null while still running. */
    durationSec: number | null;
    /** Non-zero exit code for failures; null otherwise. */
    exitCode: number | null;
    /** Host-local timestamps, "YYYY-MM-DDTHH:mm:ss" (no zone — the log has none). */
    startedAt: string | null;
    endedAt: string | null;
    /** Captured [OUTPUT] lines, most recent MAX_OUTPUT_LINES kept. */
    output: string[];
    /** True when older output lines were dropped to bound the payload. */
    outputTruncated: boolean;
}

export type RunStatus = "success" | "failures" | "running";

export interface SelfCheckRun {
    /** Host-local, "YYYY-MM-DDTHH:mm:ss". null only for a truncated run. */
    startedAt: string | null;
    endedAt: string | null;
    status: RunStatus;
    passed: number;
    failed: number;
    /** Scripts that produced a result line (excludes one still running). */
    total: number;
    durationSec: number | null;
    scripts: ScriptResult[];
    /**
     * True when the run's `Self-check starting` line was not in the supplied
     * tail, so the script list is incomplete and the tally understates reality.
     */
    truncated: boolean;
}

// Per-script output retention. Failures re-run their command verbosely
// ("quiet success, verbose failure"), so the tail is what carries the
// diagnostic — keep the last N lines rather than the first.
const MAX_OUTPUT_LINES = 200;

interface LogEntry {
    date: string;
    time: string;
    level: string;
    message: string;
}

const LINE_RE = /^\[(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})\]\s+\[([A-Z]+)\]\s?(.*)$/;

const RUN_START_RE = /^===\s+Self-check starting/;
const RUN_END_RE = /^===\s+Self-check completed (successfully|with failures)/;

// Anchored on the level tag as well as the text, so a child script that echoes
// "… : success" in its own [OUTPUT] lines can't be miscounted as a result line.
const SCRIPT_START_RE = /^===\s+\[[^\]]+\]\s+(\S+)\s+:\s+starting\s+===/;
const SCRIPT_OK_RE = /^===\s+\[[^\]]+\]\s+(\S+)\s+:\s+success\s+\((\d+)s\)/;
const SCRIPT_FAIL_RE = /^===\s+\[[^\]]+\]\s+(\S+)\s+:\s+failed\s+\(exit code:\s*(\d+),\s*(\d+)s\)/;

function parseLine(raw: string): LogEntry | null {
    const m = raw.match(LINE_RE);
    if (!m) return null;
    return { date: m[1], time: m[2], level: m[3], message: m[4] };
}

function stamp(entry: LogEntry): string {
    return `${entry.date}T${entry.time}`;
}

/**
 * Difference between two "YYYY-MM-DDTHH:mm:ss" host-local stamps, in seconds.
 * Both are in the same (unknown) zone, so interpreting the components as UTC
 * yields the correct delta without needing to know which zone that is.
 */
function diffSeconds(from: string | null, to: string | null): number | null {
    if (!from || !to) return null;
    const a = Date.parse(`${from}Z`);
    const b = Date.parse(`${to}Z`);
    if (Number.isNaN(a) || Number.isNaN(b)) return null;
    const delta = Math.round((b - a) / 1000);
    return delta >= 0 ? delta : null;
}

function pushOutput(script: ScriptResult, line: string): void {
    script.output.push(line);
    if (script.output.length > MAX_OUTPUT_LINES) {
        script.output.shift();
        script.outputTruncated = true;
    }
}

/**
 * Build one run from the entries between (and including) its boundary lines.
 * `startEntry` is null for a run whose opening line fell outside the tail.
 */
function buildRun(
    startEntry: LogEntry | null,
    endEntry: LogEntry | null,
    body: LogEntry[]
): SelfCheckRun {
    const scripts: ScriptResult[] = [];
    let current: ScriptResult | null = null;

    // Close an open script by name. Scripts can legitimately appear twice in
    // one run (self-check.sh's second pass re-reads scripts-config.txt), so
    // resolve against the most recent still-open entry rather than the first.
    const takeOpen = (name: string): ScriptResult | null => {
        for (let i = scripts.length - 1; i >= 0; i--) {
            if (scripts[i].name === name && scripts[i].status === "running") {
                return scripts[i];
            }
        }
        return null;
    };

    for (const entry of body) {
        const { level, message } = entry;

        if (level === "INFO") {
            const m = message.match(SCRIPT_START_RE);
            if (m) {
                current = {
                    name: m[1],
                    status: "running",
                    durationSec: null,
                    exitCode: null,
                    startedAt: stamp(entry),
                    endedAt: null,
                    output: [],
                    outputTruncated: false,
                };
                scripts.push(current);
                continue;
            }
        }

        if (level === "SUCCESS") {
            const m = message.match(SCRIPT_OK_RE);
            if (m) {
                // A result line with no matching start (truncated tail) still
                // counts — synthesise an entry so the tally stays honest.
                const script = takeOpen(m[1]) ?? {
                    name: m[1],
                    status: "running" as ScriptStatus,
                    durationSec: null,
                    exitCode: null,
                    startedAt: null,
                    endedAt: null,
                    output: [],
                    outputTruncated: false,
                };
                if (!scripts.includes(script)) scripts.push(script);
                script.status = "success";
                script.durationSec = parseInt(m[2], 10);
                script.endedAt = stamp(entry);
                current = null;
                continue;
            }
        }

        if (level === "ERROR") {
            const m = message.match(SCRIPT_FAIL_RE);
            if (m) {
                const script = takeOpen(m[1]) ?? {
                    name: m[1],
                    status: "running" as ScriptStatus,
                    durationSec: null,
                    exitCode: null,
                    startedAt: null,
                    endedAt: null,
                    output: [],
                    outputTruncated: false,
                };
                if (!scripts.includes(script)) scripts.push(script);
                script.status = "failed";
                script.exitCode = parseInt(m[2], 10);
                script.durationSec = parseInt(m[3], 10);
                script.endedAt = stamp(entry);
                current = null;
                continue;
            }
        }

        // Everything the running script wrote goes into its own bucket. ERROR
        // lines from execute_script_with_logging itself (e.g. "Script is not
        // executable") land here too, which is where you want to read them.
        if (current && (level === "OUTPUT" || level === "ERROR" || level === "WARN")) {
            pushOutput(current, message);
        }
    }

    const passed = scripts.filter((s) => s.status === "success").length;
    const failed = scripts.filter((s) => s.status === "failed").length;

    const startedAt = startEntry ? stamp(startEntry) : null;
    const endedAt = endEntry ? stamp(endEntry) : null;

    let status: RunStatus;
    if (!endEntry) {
        status = "running";
    } else {
        status = RUN_END_RE.exec(endEntry.message)?.[1] === "successfully"
            ? "success"
            : "failures";
    }

    return {
        startedAt,
        endedAt,
        status,
        passed,
        failed,
        total: passed + failed,
        durationSec: diffSeconds(startedAt, endedAt),
        scripts,
        truncated: startEntry === null,
    };
}

/**
 * Parse every self-check run present in a log tail, oldest first.
 *
 * A run whose opening line fell outside the tail is still returned, flagged
 * `truncated`. A run with no completion line yet is returned with status
 * "running" — that is the live view during a manual "Run now".
 */
export function parseSelfCheckRuns(logText: string): SelfCheckRun[] {
    const runs: SelfCheckRun[] = [];

    let startEntry: LogEntry | null = null;
    let body: LogEntry[] = [];
    let inRun = false;
    let sawAnything = false;

    for (const raw of logText.split("\n")) {
        const entry = parseLine(raw);
        if (!entry) continue;

        if (entry.level === "INFO" && RUN_START_RE.test(entry.message)) {
            // A start line while a run is open means the previous one never
            // completed (host killed mid-run) — close it as still-running.
            if (inRun) runs.push(buildRun(startEntry, null, body));
            startEntry = entry;
            body = [];
            inRun = true;
            sawAnything = true;
            continue;
        }

        if (entry.level === "INFO" && RUN_END_RE.test(entry.message)) {
            // A completion with no start in the tail is a truncated run.
            runs.push(buildRun(inRun ? startEntry : null, entry, body));
            startEntry = null;
            body = [];
            inRun = false;
            sawAnything = true;
            continue;
        }

        // Lines before the first boundary belong to a truncated leading run;
        // keep them so its script list isn't empty.
        if (inRun || !sawAnything) body.push(entry);
    }

    if (inRun) runs.push(buildRun(startEntry, null, body));

    return runs;
}

/** The most recent run in the tail, running or not. */
export function latestSelfCheckRun(logText: string): SelfCheckRun | null {
    const runs = parseSelfCheckRuns(logText);
    return runs.length ? runs[runs.length - 1] : null;
}

/** The most recent run that reached a completion line. */
export function latestCompletedSelfCheckRun(logText: string): SelfCheckRun | null {
    const runs = parseSelfCheckRuns(logText);
    for (let i = runs.length - 1; i >= 0; i--) {
        if (runs[i].status !== "running") return runs[i];
    }
    return null;
}
