import DEFAULT_BRAND_JSON from './brand.default.json';
import {toBrandPayload} from './brandPayload';
import type {BrandFile, BrandPayload} from './BrandTypes';

/**
 * The baked default, pre-resolved to a BrandPayload — the CLIENT-side seed.
 *
 * This is what the UI renders if /api/brand is unreachable. AppLoader only
 * console.error()s on failure and would otherwise sit on the spinner forever,
 * so the brand layer must degrade rather than reject: worst case the app shows
 * default branding, never a dead page.
 *
 * Must NOT import loadBrandFile or resolveBrand — both pull `fs` and the
 * server config reader into the browser bundle. Only the JSON and the pure
 * transform belong here.
 *
 * serverDomain is '' because the client has no DOMAIN; the default carries an
 * operator, so the provider link resolves from that and the domain-provider
 * fallback is not needed for the seed.
 */
const DEFAULT_BRAND = DEFAULT_BRAND_JSON as BrandFile;

export const BRAND_DEFAULT_PAYLOAD: BrandPayload = toBrandPayload(DEFAULT_BRAND, {
    hasOperator: DEFAULT_BRAND.operator !== null,
    serverDomain: '',
});
