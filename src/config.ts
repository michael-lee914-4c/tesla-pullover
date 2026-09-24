const AUTH_GLOBAL = "https://fleet-auth.prd.vn.cloud.tesla.com/oauth2/v3";
const AUTHORIZE_GLOBAL = "https://auth.tesla.com/oauth2/v3/authorize";
const AUTH_CN = "https://auth.tesla.cn/oauth2/v3";
const AUTHORIZE_CN = "https://auth.tesla.cn/oauth2/v3/authorize";

export const REGIONS = {
  na: "https://fleet-api.prd.na.vn.cloud.tesla.com",
  eu: "https://fleet-api.prd.eu.vn.cloud.tesla.com",
  cn: "https://fleet-api.prd.cn.vn.cloud.tesla.cn",
} as const;

export type TeslaRegion = keyof typeof REGIONS;

export const SCOPES = [
  "openid",
  "offline_access",
  "vehicle_device_data",
  "vehicle_cmds",
  "vehicle_location",
] as const;

export const SERVER_NAME = "tesla-pullover";
export const SERVER_VERSION = "0.1.0";

export function env(name: string, fallback = ""): string {
  return process.env[name]?.trim() || fallback;
}

export function requiredEnv(name: string): string {
  const value = env(name);
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

export function isMockMode(): boolean {
  const raw = env("TESLA_MOCK", env("TESLA_DRY_RUN"));
  return raw === "1" || raw.toLowerCase() === "true" || raw.toLowerCase() === "yes";
}

export function region(): TeslaRegion {
  const raw = env("TESLA_REGION", "na").toLowerCase();
  if (raw === "eu" || raw === "cn" || raw === "na") return raw;
  return "na";
}

/** Token endpoint origin. China accounts must use auth.tesla.cn; NA/EU share the global Fleet auth host. */
export function authBase(): string {
  return region() === "cn" ? AUTH_CN : AUTH_GLOBAL;
}

/** Browser authorize URL. China login is on auth.tesla.cn; NA/EU use auth.tesla.com. */
export function authorizeUrl(): string {
  return region() === "cn" ? AUTHORIZE_CN : AUTHORIZE_GLOBAL;
}

export function fleetBase(): string {
  return env("TESLA_FLEET_BASE", REGIONS[region()]).replace(/\/$/, "");
}

export function commandBase(): string {
  return env("TESLA_COMMAND_BASE").replace(/\/$/, "");
}

export function cachePath(): string {
  return env("TESLA_CACHE_PATH", new URL("../token-cache.json", import.meta.url).pathname);
}

export function redirectUri(): string {
  return requiredEnv("TESLA_REDIRECT_URI");
}

export function defaultVin(): string {
  return env("TESLA_VIN");
}

export function vinOrDefault(vin?: string): string {
  const value = vin?.trim() || defaultVin();
  if (!value) throw new Error("Missing vin (pass vin or set TESLA_VIN)");
  return value;
}

export function googleMapsKey(): string {
  return env("GOOGLE_MAPS_API_KEY");
}

export function geocodeProvider(): "auto" | "google" | "nominatim" | "mock" {
  const raw = env("GEOCODE_PROVIDER", isMockMode() ? "mock" : "auto").toLowerCase();
  if (raw === "google" || raw === "nominatim" || raw === "mock") return raw;
  return "auto";
}

export function geocodeUserAgent(): string {
  return env("GEOCODE_USER_AGENT", `tesla-pullover/${SERVER_VERSION}`);
}

export function minDistanceM(): number {
  return intEnv("PULLOVER_MIN_DISTANCE_M", 200);
}

export function maxDistanceM(): number {
  return intEnv("PULLOVER_MAX_DISTANCE_M", 2000);
}

export function wakeWaitMs(): number {
  return intEnv("TESLA_WAKE_WAIT_MS", 8000);
}

export function intEnv(name: string, fallback: number): number {
  const raw = env(name);
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new Error(`${name} must be a number`);
  return Math.floor(n);
}
