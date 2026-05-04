import {BaseConfig, getConfig as getConfigBackend} from "dashboard-core/backend/config/LocalBackendConfig";

type Config = {
    BASE_PATH: string;
    JWT_SECRET: string;
    COMPOSE_FOLDER_PATH: string;
    HOST_ADDRESS: string; //optional, used for host commands
    MOCK: string;
    OIDC_REGISTRAR_URL: string;

    DOMAIN: string;
    PROVIDER_STR: string;
    UID: string;
    DEFAULT_PWD: string;
    PUBLIC_IP: string;
    DEFAULT_USER: string;
    DEFAULT_SERVICE_HOST: string;
    DEFAULT_SERVICE_PORT: string;

    YUNDERA_USER_API: string; // Orchestrator base URL, used for support-key fetch
    SMTP_HOST: string;        // Local PCS smtp service hostname (default: smtp)
    SMTP_PORT: string;        // Local PCS smtp service port (default: 587)
    SUPPORT_EMAIL: string;    // Override support recipient (default: support@yundera.com)

} & BaseConfig;

export function getConfig(key: keyof Config): string {
    return getConfigBackend<Config>(key);
}
