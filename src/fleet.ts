import { acquireToken } from "./auth.ts";
import { commandBase, fleetBase, isMockMode, vinOrDefault } from "./config.ts";
import { asNumber, asRecord, asString, endpointsQuery } from "./util.ts";

export type FleetJson = Record<string, unknown>;

export type VehicleSummary = {
  vin: string;
  display_name?: string;
  state?: string;
};

export type VehicleState = {
  vin: string;
  state: string;
  display_name?: string;
};

export type VehicleLocation = {
  vin: string;
  lat: number;
  lon: number;
  heading: number;
};

export type CommandResult = {
  ok: boolean;
  method: "navigation_gps_request" | "navigation_request";
  order?: number;
  response: unknown;
};

export type NavigateInput = {
  vin?: string;
  lat?: number;
  lon?: number;
  address?: string;
  order?: number;
};

export type FleetClient = {
  listVehicles(): Promise<VehicleSummary[]>;
  getVehicle(vin: string): Promise<VehicleState>;
  wake(vin: string): Promise<VehicleState>;
  getLocation(vin: string): Promise<VehicleLocation>;
  navigate(input: NavigateInput): Promise<CommandResult>;
};

export async function fleetRequest(
  method: string,
  path: string,
  body?: unknown,
  opts: { command?: boolean } = {},
): Promise<FleetJson> {
  const token = await acquireToken();
  const base = opts.command ? commandBase() : fleetBase();
  if (opts.command && !base) {
    throw new Error(
      "Missing TESLA_COMMAND_BASE (tesla-http-proxy or Teslemetry). Modern cars reject unsigned Fleet commands.",
    );
  }
  const url = path.startsWith("http") ? path : `${base}${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return { ok: true };
  const text = await res.text();
  const json = text ? (JSON.parse(text) as FleetJson) : {};
  if (!res.ok) {
    const err = json.error as string | FleetJson | undefined;
    const nested = err && typeof err === "object" ? asString(err.message) : undefined;
    const msg = typeof err === "string" ? err : nested ?? text;
    throw new Error(`Tesla ${res.status} ${method} ${path}: ${msg}`.trim());
  }
  return json;
}

function vehiclePath(vin: string, suffix = ""): string {
  return `/api/1/vehicles/${encodeURIComponent(vin)}${suffix}`;
}

export function unwrapResponse(payload: FleetJson): Record<string, unknown> {
  const response = payload.response;
  if (Array.isArray(response)) return { items: response };
  return asRecord(response ?? payload);
}

export function extractVehicleState(payload: FleetJson, fallbackVin: string): VehicleState {
  const response = asRecord(payload.response ?? payload);
  return {
    vin: asString(response.vin) ?? fallbackVin,
    state: asString(response.state) ?? "unknown",
    display_name: asString(response.display_name) ?? asString(response.vehicle_name),
  };
}

export function extractLocation(payload: FleetJson, vin: string): VehicleLocation {
  const response = asRecord(payload.response ?? payload);
  const drive = asRecord(response.drive_state);
  const location = asRecord(response.location_data);
  const lat = asNumber(location.latitude ?? location.est_lat ?? drive.latitude ?? response.latitude);
  const lon = asNumber(
    location.longitude ?? location.est_lng ?? location.est_lon ?? drive.longitude ?? response.longitude,
  );
  const heading = asNumber(drive.heading ?? location.heading ?? response.heading) ?? 0;
  if (lat === undefined || lon === undefined) {
    throw new Error("vehicle_data did not include latitude/longitude. Request location_data;drive_state.");
  }
  return { vin, lat, lon, heading };
}

export function navigationShareBody(location: string, locale = "en-US"): Record<string, unknown> {
  return {
    type: "share_ext_content_raw",
    locale,
    timestamp_ms: String(Date.now()),
    value: { "android.intent.extra.TEXT": location },
  };
}

export function navigationGpsBody(lat: number, lon: number, order = 1): Record<string, unknown> {
  return {
    lat,
    lon,
    order,
    gps: { latitude: lat, longitude: lon },
  };
}

function summarizeVehicles(payload: FleetJson): VehicleSummary[] {
  const items = Array.isArray(payload.response) ? payload.response : asRecord(payload).items;
  if (!Array.isArray(items)) return [];
  return items.map((item) => {
    const row = asRecord(item);
    return {
      vin: asString(row.vin) ?? "",
      display_name: asString(row.display_name),
      state: asString(row.state),
    };
  });
}

export function createHttpFleet(): FleetClient {
  return {
    async listVehicles() {
      return summarizeVehicles(await fleetRequest("GET", "/api/1/vehicles"));
    },
    async getVehicle(vin) {
      return extractVehicleState(await fleetRequest("GET", vehiclePath(vin)), vin);
    },
    async wake(vin) {
      return extractVehicleState(await fleetRequest("POST", vehiclePath(vin, "/wake_up")), vin);
    },
    async getLocation(vin) {
      const query = endpointsQuery("location_data;drive_state");
      const payload = await fleetRequest("GET", `${vehiclePath(vin, "/vehicle_data")}${query}`);
      return extractLocation(payload, vin);
    },
    async navigate(input) {
      const vin = vinOrDefault(input.vin);
      const order = input.order ?? 1;
      const hasGps = input.lat !== undefined && input.lon !== undefined;
      if (hasGps) {
        try {
          const response = await fleetRequest(
            "POST",
            vehiclePath(vin, "/command/navigation_gps_request"),
            navigationGpsBody(input.lat!, input.lon!, order),
            { command: true },
          );
          return { ok: true, method: "navigation_gps_request", order, response };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (!/invalid_command|404|not (supported|found)|command requires using the REST API/i.test(message)) {
            throw error;
          }
          const share = input.address?.trim() || `${input.lat}, ${input.lon}`;
          const response = await fleetRequest(
            "POST",
            vehiclePath(vin, "/command/navigation_request"),
            navigationShareBody(share),
            { command: true },
          );
          return { ok: true, method: "navigation_request", order, response };
        }
      }
      if (!input.address?.trim()) {
        throw new Error("navigate_to needs lat/lon or address");
      }
      const response = await fleetRequest(
        "POST",
        vehiclePath(vin, "/command/navigation_request"),
        navigationShareBody(input.address.trim()),
        { command: true },
      );
      return { ok: true, method: "navigation_request", order, response };
    },
  };
}

export const MOCK_VIN = "MOCKVIN000000001";

export type MockFleetOptions = {
  vin?: string;
  state?: string;
  lat?: number;
  lon?: number;
  heading?: number;
  display_name?: string;
};

export type MockFleet = FleetClient & {
  calls: Array<{ method: string; vin?: string; extra?: unknown }>;
  options: Required<MockFleetOptions>;
};

export function createMockFleet(options: MockFleetOptions = {}): MockFleet {
  const state: Required<MockFleetOptions> = {
    vin: options.vin ?? MOCK_VIN,
    state: options.state ?? "online",
    lat: options.lat ?? 37.4419,
    lon: options.lon ?? -122.143,
    heading: options.heading ?? 90,
    display_name: options.display_name ?? "Mock Vehicle",
  };
  const calls: MockFleet["calls"] = [];
  return {
    calls,
    options: state,
    async listVehicles() {
      calls.push({ method: "listVehicles" });
      return [{ vin: state.vin, display_name: state.display_name, state: state.state }];
    },
    async getVehicle(vin) {
      calls.push({ method: "getVehicle", vin });
      return { vin: state.vin, state: state.state, display_name: state.display_name };
    },
    async wake(vin) {
      calls.push({ method: "wake", vin });
      state.state = "online";
      return { vin: state.vin, state: "online", display_name: state.display_name };
    },
    async getLocation(vin) {
      calls.push({ method: "getLocation", vin });
      if (state.state !== "online") {
        throw new Error("vehicle unavailable: vehicle is offline or asleep");
      }
      return { vin: state.vin, lat: state.lat, lon: state.lon, heading: state.heading };
    },
    async navigate(input) {
      const vin = input.vin ?? state.vin;
      calls.push({ method: "navigate", vin, extra: input });
      if (input.lat !== undefined && input.lon !== undefined) {
        return {
          ok: true,
          method: "navigation_gps_request",
          order: input.order ?? 1,
          response: { response: { result: true, reason: "" } },
        };
      }
      if (!input.address?.trim()) throw new Error("navigate_to needs lat/lon or address");
      return {
        ok: true,
        method: "navigation_request",
        order: input.order ?? 1,
        response: { response: { result: true, reason: "" } },
      };
    },
  };
}

export function createFleet(): FleetClient {
  return isMockMode() ? createMockFleet() : createHttpFleet();
}
