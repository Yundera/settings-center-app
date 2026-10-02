/**
 * Shell-quote a value for safe single-argument substitution.
 * Wraps in single quotes and escapes any single quotes inside.
 */
export function shq(s: string): string {
    return `'${s.replace(/'/g, `'\\''`)}'`;
}
