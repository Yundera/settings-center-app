import {BaseConfig, getConfig as getConfigBackend} from "dashboard-core/backend/LocalBackendConfig";

type Config = {
  BASE_PATH: string;
  JWT_SECRET: string;
  AUTHORITY_ENDPOINT: string;
} & BaseConfig;

export function getConfig(key: keyof Config): string {
  return getConfigBackend<Config>(key);
}