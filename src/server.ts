import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { SERVER_NAME, SERVER_VERSION } from "./config.ts";
import { createDeps, findSafeStop, locateVehicle, navigateTo, pullOver, resolveVin, type AppDeps } from "./pullover.ts";
import { PULLOVER_TOOLS } from "./tools.ts";
import { runTool } from "./util.ts";

const vinArg = { vin: z.string().optional() };

export function createPulloverServer(overrides: Partial<AppDeps> = {}): McpServer {
  const deps = createDeps(overrides);
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });

  server.tool(
    "pull_over",
    "Find a safe stop just ahead (parking / rest area / side street) from the vehicle location and send navigation so FSD can drive there. Uses Fleet vehicle_get then one location_data read. Navigation uses navigation_gps_request (order=1) via the command proxy, with navigation_request fallback. Needs command proxy.",
    {
      vin: z.string().optional(),
      max_distance_m: z.number().int().positive().optional(),
    },
    async ({ vin, max_distance_m }) => runTool(() => pullOver(deps, { vin, max_distance_m })),
  );

  server.tool(
    "find_safe_stop",
    "Dry-run: read vehicle location/heading and rank a safe pull-off ahead. Does not send navigation.",
    {
      vin: z.string().optional(),
      max_distance_m: z.number().int().positive().optional(),
    },
    async ({ vin, max_distance_m }) => runTool(() => findSafeStop(deps, { vin, max_distance_m })),
  );

  server.tool(
    "navigate_to",
    "Send a navigation destination to the car. Prefer lat/lon (navigation_gps_request, order=1). Address uses navigation_request share-to-car. Needs command proxy.",
    {
      vin: z.string().optional(),
      address: z.string().optional(),
      lat: z.number().optional(),
      lon: z.number().optional(),
      order: z.number().int().positive().optional(),
    },
    async ({ vin, address, lat, lon, order }) =>
      runTool(() => navigateTo(deps, { vin, address, lat, lon, order })),
  );

  server.tool("vehicles_list", "List vehicles on the signed-in Tesla account.", {}, async () =>
    runTool(() => deps.fleet.listVehicles()),
  );

  server.tool(
    "vehicle_location",
    "Cheap vehicle_get, wake once if needed, then a single vehicle_data location_data;drive_state read. Do not call this in a tight loop.",
    vinArg,
    async ({ vin }) =>
      runTool(async () => {
        const resolved = await resolveVin(deps.fleet, vin);
        return locateVehicle(deps, resolved);
      }),
  );

  return server;
}

export function registeredToolNames(): string[] {
  return PULLOVER_TOOLS.map((tool) => tool.name);
}
