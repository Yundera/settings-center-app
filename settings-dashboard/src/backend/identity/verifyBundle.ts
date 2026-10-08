import {compactDecrypt, decodeProtectedHeader, JWTVerifyGetKey, jwtVerify, KeyLike} from 'jose';

/**
 * Decrypt and verify an identity bundle. Pure apart from its inputs (the
 * one-time key lookup and the issuer's key set), so it can be driven from a
 * script with keys of its own.
 *
 * Contract: pcs-orchestrator doc/identity-push.md, "Wire contract".
 */

export const BUNDLE_TYP = 'pcs-identity+jwt';
export const BUNDLE_AUD = 'pcs-identity';

export interface IdentityBundle {
    UID: string;
    DOMAIN: string;
    EMAIL: string;
    DOMAIN_UID: string;
    USER_JWT: string;
    PROVIDER_STR: string;
}

export interface VerifiedBundle {
    host: string;
    iat: number;
    bundle: IdentityBundle;
}

export class BundleRejected extends Error {}

/**
 * Every value ends up in an env file through a shell script, so each one gets
 * a strict shape: no quotes, no whitespace, no `$`, nothing a shell or the env
 * file format could reinterpret. EMAIL may legitimately be empty.
 */
const SHAPES: Record<keyof IdentityBundle, RegExp> = {
    UID: /^[A-Za-z0-9_.@-]{1,128}$/,
    DOMAIN: /^[a-z0-9.-]{1,253}$/,
    EMAIL: /^[A-Za-z0-9._%+@-]{0,254}$/,
    DOMAIN_UID: /^[A-Za-z0-9_.@-]{1,200}$/,
    USER_JWT: /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/,
    PROVIDER_STR: /^https:\/\/[A-Za-z0-9.-]+,[A-Za-z0-9_.@-]+,[A-Za-z0-9]+$/,
};

function checkBundle(raw: unknown): IdentityBundle {
    if (!raw || typeof raw !== 'object') throw new BundleRejected('bundle missing');
    const out: Partial<IdentityBundle> = {};
    for (const key of Object.keys(SHAPES) as (keyof IdentityBundle)[]) {
        const v = (raw as Record<string, unknown>)[key];
        if (typeof v !== 'string' || v.length > 4096 || !SHAPES[key].test(v)) {
            throw new BundleRejected(`bad ${key}`);
        }
        out[key] = v;
    }
    return out as IdentityBundle;
}

export async function openBundle(
    jwe: string,
    takeKey: (kid: string) => KeyLike | null,
    issuer: string,
    issuerKeys: JWTVerifyGetKey,
): Promise<VerifiedBundle> {
    if (typeof jwe !== 'string' || jwe.length > 16_384) throw new BundleRejected('bad jwe');

    let kid: unknown;
    try {
        kid = decodeProtectedHeader(jwe).kid;
    } catch {
        throw new BundleRejected('bad jwe');
    }
    const key = typeof kid === 'string' ? takeKey(kid) : null;
    if (!key) throw new BundleRejected('unknown or used key');

    let jws: string;
    try {
        const {plaintext} = await compactDecrypt(jwe, key, {
            keyManagementAlgorithms: ['ECDH-ES'],
            contentEncryptionAlgorithms: ['A256GCM'],
        });
        jws = new TextDecoder().decode(plaintext);
    } catch {
        throw new BundleRejected('cannot decrypt');
    }

    let payload;
    try {
        ({payload} = await jwtVerify(jws, issuerKeys, {
            issuer,
            audience: BUNDLE_AUD,
            typ: BUNDLE_TYP,
            algorithms: ['RS256'],
            requiredClaims: ['iat', 'exp'],
        }));
    } catch (e) {
        throw new BundleRejected(`signature: ${(e as Error)?.message ?? e}`);
    }

    if (typeof payload.host !== 'string' || payload.host.length > 64) throw new BundleRejected('bad host');
    return {host: payload.host, iat: payload.iat as number, bundle: checkBundle(payload.bundle)};
}
