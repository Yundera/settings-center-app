import {BaseConfig, getConfig as getConfigBackend} from "dashboard-core/backend/config/LocalBackendConfig";

type Config = {
    BASE_PATH: string;
    JWT_SECRET: string;
    AUTHORITY_ENDPOINT: string;
    COMPOSE_FOLDER_PATH: string;
    HOST_ADDRESS: string; //optional, used for host commands
    MOCK: string;

    DOMAIN: string;
    PROVIDER_STR: string;
    UID: string;
    DEFAULT_PWD: string;
    PUBLIC_IP: string;
    DEFAULT_USER: string;

} & BaseConfig;

export function getConfig(key: keyof Config): string {
    return getConfigBackend<Config>(key);
}