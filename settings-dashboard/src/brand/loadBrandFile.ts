import fs from 'fs';
import path from 'path';
import DEFAULT_BRAND_JSON from './brand.default.json';
import {mergeBrandFile} from './brandPayload';
import type {BrandFile} from './BrandTypes';
import {getConfig} from '@/configuration/getConfigBackend';

/**
 * Loads brand.json: the baked default, optionally overridden by a file the
 * stack drops next to its compose file.
 *
 * WHERE THE OVERRIDE LIVES — this is the easy thing to get wrong.
 * COMPOSE_FOLDER_PATH (/DATA/AppData/casaos/apps/yundera/) is a HOST path. It
 * is only ever used to build strings for executeHostCommand(), i.e. commands
 * that run on the PCS host over SSH. It is NOT readable from inside this
 * container. The stack directory is bind-mounted here at /app/data (see the
 * admin service in template-root's docker-compose.yml), so that is the path
 * that actually resolves. The COMPOSE_FOLDER_PATH candidate is kept last for
 * a hypothetical non-containerised run; it is expected to miss in prod.
 */

const SUPPORTED_SCHEMA_VERSION = 1;

/**
 * serverGate.ts bypasses the `/logo` prefix for unauthenticated requests. The
 * login page is unauthenticated, so a logo outside that prefix 302s to /login
 * and renders as a broken image. Defence-in-depth against an honest
 * misconfiguration, not against a hostile one — anyone who can write
 * brand.json already owns the compose file.
 */
const LOGO_PATTERN = /^\/logo[\w.\-]*\.(svg|png|webp)$/;

const DEFAULT_BRAND = DEFAULT_BRAND_JSON as BrandFile;

/** Re-`stat` the override at most this often. */
const STAT_INTERVAL_MS = 10_000;

interface CacheEntry {
    value: BrandFile;
    /** mtime of the override that produced `value`; null when none was found. */
    mtimeMs: number | null;
    checkedAt: number;
}

let cache: CacheEntry | null = null;

function overrideCandidates(): string[] {
    const candidates: string[] = [];
    const explicit = process.env.BRAND_CONFIG_PATH;
    if (explicit) candidates.push(explicit);

    // The one that actually resolves in prod and in the dev harness.
    candidates.push('/app/data/brand.json');

    // Last resort: correct only if this ever runs outside the container.
    const composeFolder = getConfig('COMPOSE_FOLDER_PATH') || '/DATA/AppData/casaos/apps/yundera/';
    candidates.push(path.join(composeFolder, 'brand.json'));

    return candidates;
}

function firstExisting(): {file: string; mtimeMs: number} | null {
    for (const candidate of overrideCandidates()) {
        try {
            const stat = fs.statSync(candidate);
            if (stat.isFile()) return {file: candidate, mtimeMs: stat.mtimeMs};
        } catch {
            // ENOENT / EACCES — try the next candidate.
        }
    }
    return null;
}

function readOverride(file: string): BrandFile {
    let parsed: Partial<BrandFile>;
    try {
        parsed = JSON.parse(fs.readFileSync(file, 'utf-8'));
    } catch (err) {
        console.warn(`[brand] ignoring malformed ${file}: ${err instanceof Error ? err.message : String(err)}`);
        return DEFAULT_BRAND;
    }

    if (parsed?.schemaVersion !== SUPPORTED_SCHEMA_VERSION) {
        console.warn(
            `[brand] ignoring ${file}: schemaVersion ${parsed?.schemaVersion} ` +
            `(this build understands ${SUPPORTED_SCHEMA_VERSION})`,
        );
        return DEFAULT_BRAND;
    }

    let merged: BrandFile;
    try {
        merged = mergeBrandFile(DEFAULT_BRAND, parsed);
    } catch (err) {
        console.warn(`[brand] ignoring ${file}: merge failed — ${err instanceof Error ? err.message : String(err)}`);
        return DEFAULT_BRAND;
    }

    if (!LOGO_PATTERN.test(merged.brand.logo)) {
        console.warn(
            `[brand] ${file} sets logo "${merged.brand.logo}", which is outside the ` +
            `unauthenticated /logo prefix and would break the login page — ` +
            `falling back to "${DEFAULT_BRAND.brand.logo}"`,
        );
        merged = {...merged, brand: {...merged.brand, logo: DEFAULT_BRAND.brand.logo}};
    }

    return merged;
}

/**
 * Returns the effective brand file. Synchronous and NEVER throws — that is
 * what lets the login-page RSC and the API route call it without try/catch.
 * Any failure degrades to the baked default with a warning.
 */
export function loadBrandFile(): BrandFile {
    const now = Date.now();
    if (cache && now - cache.checkedAt < STAT_INTERVAL_MS) return cache.value;

    let found: {file: string; mtimeMs: number} | null = null;
    try {
        found = firstExisting();
    } catch {
        found = null;
    }

    // Unchanged override (or still no override): keep the parsed value, just
    // push the check window forward. Lets an operator edit brand.json and see
    // it within STAT_INTERVAL_MS without recreating the container.
    if (cache && cache.mtimeMs === (found ? found.mtimeMs : null)) {
        cache = {...cache, checkedAt: now};
        return cache.value;
    }

    const value = found ? readOverride(found.file) : DEFAULT_BRAND;
    cache = {value, mtimeMs: found ? found.mtimeMs : null, checkedAt: now};
    return value;
}

/** Test seam — drops the memoised file so the next call re-reads. */
export function resetBrandCache(): void {
    cache = null;
}
