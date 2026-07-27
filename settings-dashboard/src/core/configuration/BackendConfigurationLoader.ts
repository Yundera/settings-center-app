//frontend method

export async function loadBackendConfiguration() {
  const publicBasePath = process.env.NEXT_PUBLIC_BASE_PATH;
  const url = `${publicBasePath || ""}/api/core/config/core`;
  const response = await fetch(url);
  const conf = await response.json();
  (window as any).APP_CONFIG = {};
  (window as any).APP_CONFIG.BASE_PATH = `${publicBasePath || ""}`;
  for (const key in conf) {
    (window as any).APP_CONFIG[key] = conf[key];
  }
  console.log('Backend configuration loaded:', (window as any).APP_CONFIG);
}
