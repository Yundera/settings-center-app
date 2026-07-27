import type {DataProvider} from 'react-admin';

/**
 * Inert data provider.
 *
 * `<Admin>` requires a `dataProvider`, but this dashboard does not use
 * react-admin's data layer at all — every panel talks to the backend directly
 * through `apiRequest` (src/core/authApi.ts) or plain `fetch`. Each registered
 * `<Resource name={panel.name}/>` may still trigger a call here, so this must
 * resolve rather than throw.
 */
export const multiDataProvider = new Proxy<DataProvider>({} as DataProvider, {
    get: (_target, action) => {
        if (typeof action === 'symbol' || action === 'then') {
            return;
        }
        return async (resource: string) => {
            console.warn(`no data provider for resource '${resource}' (${String(action)})`);
            return null;
        };
    },
});
