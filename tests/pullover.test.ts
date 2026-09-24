import { describe, expect, it } from "vitest";
import { commandSucceeded, createMockFleet } from "../src/fleet.ts";
import { createMockPlaces } from "../src/geocode.ts";
import { fallbackShoulder, projectAhead, rankStops } from "../src/geo.ts";
import { findSafeStop, locateVehicle, navigateTo, pullOver } from "../src/pullover.ts";

describe("pull-over orchestration", () => {
  it("wakes once, reads location once, and does not loop vehicle_data", async () => {
    const fleet = createMockFleet({ state: "asleep", heading: 90 });
    const deps = { fleet, places: createMockPlaces(), waitAfterWakeMs: 0 };
    const location = await locateVehicle(deps, fleet.options.vin);
    expect(location.heading).toBe(90);
    expect(fleet.calls.map((call) => call.method)).toEqual(["getVehicle", "wake", "getVehicle", "getLocation"]);
    expect(fleet.calls.filter((call) => call.method === "getLocation")).toHaveLength(1);
  });

  it("finds an ahead parking stop without sending navigation", async () => {
    const fleet = createMockFleet({ heading: 90 });
    const result = await findSafeStop({ fleet, places: createMockPlaces(), waitAfterWakeMs: 0 });
    expect(result.stop.kind).toBe("parking");
    expect(result.stop.ahead).toBe(true);
    expect(result.stop.distance_m).toBeGreaterThanOrEqual(200);
    expect(result.stop.distance_m).toBeLessThanOrEqual(2000);
    expect(fleet.calls.some((call) => call.method === "navigate")).toBe(false);
  });

  it("sends navigation_gps_request with order=1 to the chosen stop", async () => {
    const fleet = createMockFleet({ heading: 45 });
    const result = await pullOver({ fleet, places: createMockPlaces(), waitAfterWakeMs: 0 });
    expect(result.navigation.method).toBe("navigation_gps_request");
    expect(result.navigation.order).toBe(1);
    expect(result.navigation.ok).toBe(true);
    const nav = fleet.calls.find((call) => call.method === "navigate");
    expect(nav?.extra).toMatchObject({
      lat: result.stop.lat,
      lon: result.stop.lon,
      address: result.stop.address,
      order: 1,
    });
  });

  it("navigate_to uses address share when coordinates are omitted", async () => {
    const fleet = createMockFleet();
    const result = await navigateTo(
      { fleet, places: createMockPlaces(), waitAfterWakeMs: 0 },
      { address: "1 Embarcadero, San Francisco, CA" },
    );
    expect(result.navigation.method).toBe("navigation_request");
    expect(fleet.calls.at(-1)?.extra).toMatchObject({ address: "1 Embarcadero, San Francisco, CA", order: 1 });
  });

  it("refuses to poll when the car stays asleep after one wake", async () => {
    const fleet = createMockFleet({ state: "asleep" });
    fleet.wake = async (vin) => {
      fleet.calls.push({ method: "wake", vin });
      return { vin: fleet.options.vin, state: "asleep", display_name: fleet.options.display_name };
    };
    await expect(locateVehicle({ fleet, places: createMockPlaces(), waitAfterWakeMs: 0 }, fleet.options.vin)).rejects.toThrow(
      /still asleep|still /i,
    );
    expect(fleet.calls.filter((call) => call.method === "getLocation")).toHaveLength(0);
  });

  it("keeps the chosen stop but marks navigation failed when Tesla returns result:false", async () => {
    const fleet = createMockFleet({ heading: 90 });
    fleet.navigate = async (input) => {
      fleet.calls.push({ method: "navigate", vin: input.vin, extra: input });
      const response = { response: { result: false, reason: "vehicle unavailable" } };
      return {
        ok: commandSucceeded(response),
        method: "navigation_gps_request",
        order: 1,
        response,
      };
    };
    const result = await pullOver({ fleet, places: createMockPlaces(), waitAfterWakeMs: 0 });
    expect(result.stop.ahead).toBe(true);
    expect(result.navigation.ok).toBe(false);
  });

  it("uses a shoulder ahead when every POI is behind the car", async () => {
    const fleet = createMockFleet({ lat: 37.4, lon: -122.1, heading: 0 });
    const origin = { lat: 37.4, lon: -122.1 };
    const behind = projectAhead(origin, 180, 300);
    const places = {
      async findStops() {
        return rankStops(origin, 0, [
          { name: "Just passed rest area", address: "behind", kind: "rest_area", ...behind },
        ]);
      },
    };
    const result = await findSafeStop({ fleet, places, waitAfterWakeMs: 0 });
    expect(result.stop.ahead).toBe(true);
    expect(result.stop.name).toBe(fallbackShoulder(origin, 0, 400).name);
  });

  it("ranks injected ahead parking over a closer behind lot", async () => {
    const fleet = createMockFleet({ lat: 37.4, lon: -122.1, heading: 0 });
    const origin = { lat: 37.4, lon: -122.1 };
    const ahead = projectAhead(origin, 0, 700);
    const behind = projectAhead(origin, 180, 250);
    const places = createMockPlaces([
      { name: "Behind lot", address: "behind", kind: "parking", ...behind },
      { name: "Ahead lot", address: "ahead", kind: "parking", ...ahead },
    ]);
    const result = await findSafeStop({ fleet, places, waitAfterWakeMs: 0 });
    expect(result.stop.name).toMatch(/Garage|Ahead lot/);
    expect(result.stop.ahead).toBe(true);
  });
});
