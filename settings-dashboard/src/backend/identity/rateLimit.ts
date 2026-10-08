/**
 * A fixed-window counter for the public identity routes. Process-wide, not
 * per caller: the routes are reached through the gate and the mesh, so the
 * caller address is not trustworthy, and the legitimate traffic is a handful
 * of requests a day from the orchestrator.
 */
export function windowLimiter(max: number, windowMs: number): () => boolean {
    let start = 0;
    let count = 0;
    return () => {
        const now = Date.now();
        if (now - start >= windowMs) {
            start = now;
            count = 0;
        }
        return ++count <= max;
    };
}
