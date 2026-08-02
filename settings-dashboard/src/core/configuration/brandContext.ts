import {BRAND_DEFAULT_PAYLOAD} from '@/brand/brandDefaultPayload';
import type {BrandPayload} from '@/brand/BrandTypes';

/**
 * Client-side brand config.
 *
 * A mutable singleton rather than a React context, mirroring the neighbouring
 * appConfigContext: AppLoader resolves it BEFORE mounting the lazy App, so
 * every consumer reads a settled value at first render and nothing ever
 * mutates it afterwards. useBrand() exists so panels don't reach for the
 * singleton directly — swapping in a real context later then touches this
 * file only.
 *
 * Pre-seeded with the baked default so a reader is never undefined, even if
 * loadBrand() has not run or failed.
 */
export const brandContext: {current: BrandPayload} = {
    current: BRAND_DEFAULT_PAYLOAD,
};

/**
 * Fetches /api/brand into the singleton.
 *
 * NEVER REJECTS — this is load-bearing. AppLoader awaits this inside its
 * providers() callback and only console.error()s on failure, leaving
 * isConfigLoaded false and the app parked on a spinner forever. Swallowing
 * here means a brand-config failure degrades to default branding rather than
 * bricking the dashboard.
 */
export async function loadBrand(): Promise<void> {
    try {
        const basePath = process.env.NEXT_PUBLIC_BASE_PATH || '';
        const res = await fetch(`${basePath}/api/brand`);
        if (!res.ok) throw new Error(`/api/brand returned ${res.status}`);
        brandContext.current = await res.json();
    } catch (err) {
        console.warn('[brand] falling back to baked defaults:', err);
    }
}

export const useBrand = (): BrandPayload => brandContext.current;
