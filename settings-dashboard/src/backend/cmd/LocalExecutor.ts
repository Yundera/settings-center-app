import { spawn } from 'child_process';

/**
 * Runs a shell command and resolves with its captured output.
 *
 * @param cmd        Command line passed to `/bin/sh -c`.
 * @param verbose    Echo the command and live output to the parent stdio.
 * @param timeoutMs  Hard wall-clock budget. When > 0, the child's entire
 *                   process group is SIGKILLed once it elapses and the call
 *                   rejects. This is what stops a hung `ssh` from lingering
 *                   forever — without it, a slow host command never returns
 *                   and (for callers on a timer) cycles pile up unbounded.
 * @param stdinData  Written to the child's stdin, which is then closed. This is
 *                   the ONLY safe channel for a secret: everything else this
 *                   module sends travels in the command line (and, for
 *                   executeHostCommand, base64 inside an ssh argv), where it is
 *                   readable from `ps` in this container and on the host. Never
 *                   logged, even when verbose.
 */
export async function execute(
    cmd: string,
    verbose = true,
    timeoutMs = 0,
    stdinData?: string,
): Promise<{ stdout: string, stderr: string }> {
    if (verbose) {
        console.log(`Executing command: ${cmd}`);
    }

    // detached:true makes the child its own process-group leader, so a timeout
    // can signal `-pid` and kill the WHOLE tree — the `/bin/sh` wrapper and the
    // `ssh` client spawned under it. Killing only the sh pid would orphan a
    // hung ssh, which is exactly the leak we are fixing.
    const child = spawn('/bin/sh', ['-c', cmd], { detached: true });

    // Feed stdin and close it. Closing matters: `ssh` (and anything reading a
    // password from stdin on the far side) blocks until EOF, so leaving the pipe
    // open turns a fast call into a timeout. EPIPE is ignored — a child that
    // exited before reading is the child's business, and the exit code below is
    // what the caller reacts to.
    if (stdinData !== undefined) {
        child.stdin.on('error', () => { /* EPIPE: child already gone */ });
        child.stdin.end(stdinData);
    } else {
        child.stdin.end();
    }

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
        const text = chunk.toString();
        stdout += text;
        if (verbose) process.stdout.write(text);
    });
    child.stderr.on('data', (chunk) => {
        const text = chunk.toString();
        stderr += text;
        if (verbose) process.stderr.write(text);
    });

    return new Promise((resolve, reject) => {
        let timedOut = false;
        let timer: NodeJS.Timeout | null = null;

        if (timeoutMs > 0) {
            timer = setTimeout(() => {
                timedOut = true;
                try {
                    // Negative pid → signal the whole process group.
                    if (child.pid) process.kill(-child.pid, 'SIGKILL');
                } catch {
                    // Process already gone — nothing to kill.
                }
            }, timeoutMs);
            timer.unref?.();
        }

        child.on('error', (err) => {
            if (timer) clearTimeout(timer);
            reject(err);
        });

        child.on('close', (code) => {
            if (timer) clearTimeout(timer);
            if (timedOut) {
                reject(new Error(`Command timed out after ${timeoutMs}ms and was killed`));
                return;
            }
            if (code === 0) {
                resolve({ stdout, stderr });
            } else {
                const detail = (stderr || stdout).trim();
                const suffix = detail ? `: ${detail}` : '';
                reject(new Error(`Command failed with code ${code}${suffix}`));
            }
        });
    });
}
