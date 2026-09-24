import { defaultVin, maxDistanceM, minDistanceM, wakeWaitMs } from "./config.ts";
import { createFleet, type CommandResult, type FleetClient, type VehicleLocation } from "./fleet.ts";
import { createPlaces, type PlaceFinder } from "./geocode.ts";
import { fallbackShoulder, type RankedStop } from "./geo.ts";
import { sleep } from "./util.ts";

export type AppDeps = {
  fleet: FleetClient;
  places: PlaceFinder;
  waitAfterWakeMs?: number;
};

export function createDeps(overrides: Partial<AppDeps> = {}): AppDeps {
  return {
    fleet: overrides.fleet ?? createFleet(),
    places: overrides.places ?? createPlaces(),
    waitAfterWakeMs: overrides.waitAfterWakeMs ?? (process.env.TESLA_MOCK ? 0 : wakeWaitMs()),
  };
}

export async function resolveVin(fleet: FleetClient, vin?: string): Promise<string> {
  const explicit = vin?.trim() || defaultVin();
  if (explicit) return explicit;
  const vehicles = await fleet.listVehicles();
  const first = vehicles.find((vehicle) => vehicle.vin);
  if (!first?.vin) throw new Error("No vehicles on this account and no vin was provided");
  return first.vin;
}

export async function locateVehicle(deps: AppDeps, vin: string): Promise<VehicleLocation> {
  const first = await deps.fleet.getVehicle(vin);
  if (first.state !== "online") {
    await deps.fleet.wake(vin);
    const wait = deps.waitAfterWakeMs ?? 0;
    if (wait > 0) await sleep(wait);
    const second = await deps.fleet.getVehicle(vin);
    if (second.state !== "online") {
      throw new Error(
        `Vehicle is still ${second.state} after one wake. Retry pull_over when it is online. vehicle_data was not polled.`,
      );
    }
  }
  return deps.fleet.getLocation(vin);
}

export type SafeStopResult = {
  vin: string;
  origin: VehicleLocation;
  stop: RankedStop;
  alternatives: RankedStop[];
};

export async function findSafeStop(
  deps: AppDeps,
  args: { vin?: string; max_distance_m?: number; origin?: VehicleLocation } = {},
): Promise<SafeStopResult> {
  const vin = await resolveVin(deps.fleet, args.vin);
  const origin = args.origin ?? (await locateVehicle(deps, vin));
  const maxM = args.max_distance_m ?? maxDistanceM();
  const minM = minDistanceM();
  let ranked = await deps.places.findStops({
    origin,
    heading: origin.heading,
    minDistanceM: minM,
    maxDistanceM: maxM,
  });
  if (ranked.length === 0) {
    ranked = (
      await deps.places.findStops({
        origin,
        heading: origin.heading,
        minDistanceM: 0,
        maxDistanceM: maxM,
      })
    ).slice();
  }
  if (ranked.length === 0) {
    const shoulder = fallbackShoulder(origin, origin.heading, Math.min(400, maxM));
    ranked = [
      {
        ...shoulder,
        distance_m: Math.min(400, maxM),
        bearing_deg: origin.heading,
        heading_delta_deg: 0,
        ahead: true,
        score: 0.4,
      },
    ];
  }
  const [stop, ...alternatives] = ranked;
  return { vin, origin, stop, alternatives: alternatives.slice(0, 4) };
}

export type PullOverResult = SafeStopResult & {
  navigation: CommandResult;
};

export async function pullOver(
  deps: AppDeps,
  args: { vin?: string; max_distance_m?: number } = {},
): Promise<PullOverResult> {
  const found = await findSafeStop(deps, args);
  const navigation = await deps.fleet.navigate({
    vin: found.vin,
    lat: found.stop.lat,
    lon: found.stop.lon,
    address: found.stop.address,
    order: 1,
  });
  return { ...found, navigation };
}

export async function navigateTo(
  deps: AppDeps,
  args: { vin?: string; address?: string; lat?: number; lon?: number; order?: number },
): Promise<{ vin: string; navigation: CommandResult }> {
  const vin = await resolveVin(deps.fleet, args.vin);
  const navigation = await deps.fleet.navigate({
    vin,
    lat: args.lat,
    lon: args.lon,
    address: args.address,
    order: args.order ?? 1,
  });
  return { vin, navigation };
}
