import {BaseConfig, getConfig as getConfigBackend} from "@/core/backend/LocalBackendConfig";

type Config = {
    BASE_PATH: string;
    SESSION_KEY: string;          // optional, base64 HMAC key (dev). If unset, key is read/written at SESSION_KEY_PATH.
    SESSION_KEY_PATH: string;     // optional path override (default: /app/data/admin-session-key).
    COMPOSE_FOLDER_PATH: string;
    HOST_ADDRESS: string; //optional, used for host commands
    MOCK: string;
    OIDC_REGISTRAR_URL: string;
    YUNDERA_OIDC_ISSUER: string;  // when set, Yundera shows up in the provider chooser.

    DOMAIN: string;
    PROVIDER_STR: string;
    UID: string;
    DEFAULT_PWD: string;
    PUBLIC_IP: string;
    DEFAULT_USER: string;
    DEFAULT_SERVICE_HOST: string;
    DEFAULT_SERVICE_PORT: string;

    YUNDERA_API: string;      // Bare orchestrator base URL (no /user); callers append explicit subpaths
    SMTP_HOST: string;        // Local PCS smtp service hostname (default: smtp)
    SMTP_PORT: string;        // Local PCS smtp service port (default: 587)
    SUPPORT_EMAIL: string;    // Override support recipient (default: support@yundera.com)

} & BaseConfig;

export function getConfig(key: keyof Config): string {
    return getConfigBackend<Config>(key);
}
