import {BaseConfig, getConfig as getConfigBackend} from "dashboard-core/backend/config/LocalBackendConfig";

type Config = {
  BASE_PATH: string;
  JWT_SECRET: string;
  AUTHORITY_ENDPOINT: string;
  COMPOSE_FOLDER_PATH: string;
  MOCK: string;
} & BaseConfig;

export function getConfig(key: keyof Config): string {
  return getConfigBackend<Config>(key);
}