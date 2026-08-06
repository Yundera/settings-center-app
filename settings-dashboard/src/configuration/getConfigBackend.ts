import {BaseConfig, getConfig as getConfigBackend} from "@/core/backend/LocalBackendConfig";

type Config = {
    BASE_PATH: string;
    SESSION_KEY: string;          // optional, base64 HMAC key (dev). If unset, key is read/written at SESSION_KEY_PATH.
    SESSION_KEY_PATH: string;     // optional path override (default: /app/data/admin-session-key).
    SESSION_EPOCH_PATH: string;   // optional path override (default: /app/data/session-epochs.json).
    COMPOSE_FOLDER_PATH: string;
    HOST_ADDRESS: string; //optional, used for host commands
    MOCK: string;
    OIDC_REGISTRAR_URL: string;

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
