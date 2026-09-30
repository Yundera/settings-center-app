import {BaseConfig, getConfig as getConfigBackend} from "@/core/backend/LocalBackendConfig";

type Config = {
    BASE_PATH: string;
    COMPOSE_FOLDER_PATH: string;
    HOST_ADDRESS: string; //optional, used for host commands
    MOCK: string;

    // --- Identity, as supplied by the AppShield gate in front of this app -----
    // Shared with the gate. Verifies the per-request identity assertion the gate
    // sends (backend/auth/gateIdentity.ts) AND signs the control tokens this app
    // uses to revoke gate sessions (backend/auth/gateControl.ts). Without it
    // NOTHING authenticates — the app fails closed by design.
    IDENTITY_ASSERTION_SECRET: string;
    // Expected `aud` on assertions = the gate's APP_NAME. Default 'admin'.
    IDENTITY_ASSERTION_AUDIENCE: string;
    // Base URL of our own gate on the pcs network. Default http://admin.
    APPSHIELD_GATE_URL: string;
    // DEV ONLY, ignored when NODE_ENV=production: `user` or `user:group,group`,
    // treats every request as that identity so the app can run without a gate.
    DEV_IDENTITY: string;

    // --- Logout --------------------------------------------------------------
    // Where to POST to end the UPSTREAM IdP's session when the user logs out, or
    // unset when there is nothing upstream to end. The gate ends its own session
    // at /nhl-auth/logout; this ends the one behind Dex, without which the next
    // sign-in is a silent redirect and the chooser never asks for a credential.
    //
    // A full URL supplied by the deployment, deliberately not derived here: this
    // app ships in the FOSS mesh template as well as the managed one and must not
    // know the name of any particular identity provider — the same rule that
    // keeps ADMIN_GROUPS vendor-neutral in backend/auth/session.ts. template-root
    // points it at Authelia's /api/logout.
    UPSTREAM_LOGOUT_URL: string;

    DOMAIN: string;
    UID: string;
    PUBLIC_IP: string;
    DEFAULT_SERVICE_HOST: string;
    DEFAULT_SERVICE_PORT: string;

    // Bare operator control-plane base URL (no /user); callers append explicit
    // subpaths. Always read via operatorApi() in ./operatorApi.ts, never
    // directly — YUNDERA_API is the pre-rename name and is still what a host
    // that has not yet run the rename migration provides.
    OPERATOR_API: string;
    YUNDERA_API: string;      // deprecated alias of OPERATOR_API
    SMTP_HOST: string;        // Local PCS smtp service hostname (default: smtp)
    SMTP_PORT: string;        // Local PCS smtp service port (default: 587)
    SUPPORT_EMAIL: string;    // Override support recipient (default: support@yundera.com)

} & BaseConfig;

export function getConfig(key: keyof Config): string {
    return getConfigBackend<Config>(key);
}
