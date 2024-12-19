type Config = {
  BASE_PATH: string;
};

export function getConfig(key: keyof Config): string {
  return (window as any).APP_CONFIG[key];
}