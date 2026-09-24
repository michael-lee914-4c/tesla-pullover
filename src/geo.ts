export type LatLon = { lat: number; lon: number };

export type PlaceKind = "parking" | "rest_area" | "gas" | "street" | "other";

export type PlaceCandidate = LatLon & {
  name: string;
  address: string;
  kind: PlaceKind;
};

export type RankedStop = PlaceCandidate & {
  distance_m: number;
  bearing_deg: number;
  heading_delta_deg: number;
  ahead: boolean;
  score: number;
};

export const KIND_WEIGHT: Record<PlaceKind, number> = {
  parking: 1,
  rest_area: 0.95,
  gas: 0.65,
  street: 0.5,
  other: 0.35,
};

const EARTH_M = 6_371_000;

export function normalizeDeg(deg: number): number {
  const wrapped = deg % 360;
  return wrapped < 0 ? wrapped + 360 : wrapped;
}

export function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

export function toDeg(rad: number): number {
  return (rad * 180) / Math.PI;
}

export function haversineM(a: LatLon, b: LatLon): number {
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function bearingDeg(from: LatLon, to: LatLon): number {
  const lat1 = toRad(from.lat);
  const lat2 = toRad(to.lat);
  const dLon = toRad(to.lon - from.lon);
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return normalizeDeg(toDeg(Math.atan2(y, x)));
}

export function headingDeltaDeg(heading: number, bearing: number): number {
  const delta = Math.abs(normalizeDeg(bearing) - normalizeDeg(heading));
  return delta > 180 ? 360 - delta : delta;
}

export function isAhead(heading: number, bearing: number, coneDeg = 90): boolean {
  return headingDeltaDeg(heading, bearing) <= coneDeg;
}

/** Destination point a given distance along a heading (degrees clockwise from north). */
export function projectAhead(origin: LatLon, headingDegValue: number, distanceM: number): LatLon {
  const angular = distanceM / EARTH_M;
  const heading = toRad(normalizeDeg(headingDegValue));
  const lat1 = toRad(origin.lat);
  const lon1 = toRad(origin.lon);
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(angular) + Math.cos(lat1) * Math.sin(angular) * Math.cos(heading),
  );
  const lon2 =
    lon1 +
    Math.atan2(
      Math.sin(heading) * Math.sin(angular) * Math.cos(lat1),
      Math.cos(angular) - Math.sin(lat1) * Math.sin(lat2),
    );
  return { lat: toDeg(lat2), lon: ((toDeg(lon2) + 540) % 360) - 180 };
}

export function searchAnchors(origin: LatLon, heading: number, maxDistanceM: number): LatLon[] {
  const distances = [0.25, 0.5, 0.8]
    .map((fraction) => Math.max(150, Math.min(maxDistanceM, maxDistanceM * fraction)))
    .filter((value, index, all) => all.indexOf(value) === index);
  return [origin, ...distances.map((meters) => projectAhead(origin, heading, meters))];
}

export function distanceScore(distanceM: number, minM: number, maxM: number): number {
  if (distanceM > maxM || distanceM <= 0) return 0;
  if (distanceM < minM) return 0.4 * (distanceM / minM);
  const peak = Math.min(Math.max(minM + 200, 600), (minM + maxM) / 2);
  if (distanceM <= peak) {
    const span = Math.max(1, peak - minM);
    return 0.45 + 0.55 * ((distanceM - minM) / span);
  }
  const span = Math.max(1, maxM - peak);
  return 1 - 0.35 * ((distanceM - peak) / span);
}

export function rankCandidate(
  origin: LatLon,
  heading: number,
  candidate: PlaceCandidate,
  minM: number,
  maxM: number,
): RankedStop {
  const distance_m = haversineM(origin, candidate);
  const bearing_deg = bearingDeg(origin, candidate);
  const heading_delta_deg = headingDeltaDeg(heading, bearing_deg);
  const ahead = heading_delta_deg <= 90;
  const aheadScore = ahead ? 1 - heading_delta_deg / 90 : 0.12 * (1 - heading_delta_deg / 180);
  const score =
    KIND_WEIGHT[candidate.kind] * 0.35 + aheadScore * 0.4 + distanceScore(distance_m, minM, maxM) * 0.25;
  return {
    ...candidate,
    distance_m,
    bearing_deg,
    heading_delta_deg,
    ahead,
    score,
  };
}

export function rankStops(
  origin: LatLon,
  heading: number,
  candidates: PlaceCandidate[],
  opts: { minM?: number; maxM?: number } = {},
): RankedStop[] {
  const minM = opts.minM ?? 200;
  const maxM = opts.maxM ?? 2000;
  const seen = new Set<string>();
  const ranked: RankedStop[] = [];
  for (const candidate of candidates) {
    if (!Number.isFinite(candidate.lat) || !Number.isFinite(candidate.lon)) continue;
    const key = `${candidate.kind}:${candidate.lat.toFixed(5)},${candidate.lon.toFixed(5)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const stop = rankCandidate(origin, heading, candidate, minM, maxM);
    if (stop.distance_m <= 0 || stop.distance_m > maxM) continue;
    ranked.push(stop);
  }
  ranked.sort((a, b) => b.score - a.score);
  const ahead = ranked.filter((stop) => stop.ahead);
  // Behind-only results must not become pull-over targets; callers synthesize a shoulder ahead.
  return ahead.length > 0 ? ahead.concat(ranked.filter((stop) => !stop.ahead)) : [];
}

export function classifyPlace(rawType: string | undefined): PlaceKind {
  const type = (rawType ?? "").toLowerCase();
  if (!type) return "other";
  if (/(parking|car_park|park_and_ride)/.test(type)) return "parking";
  if (/(rest[_ ]?(area|stop)|services|layby|lay_by|shoulder)/.test(type)) return "rest_area";
  if (/(gas|fuel|petrol)/.test(type)) return "gas";
  if (/(street|residential|address|road|unclassified)/.test(type)) return "street";
  return "other";
}

export function fallbackShoulder(origin: LatLon, heading: number, distanceM = 400): PlaceCandidate {
  const point = projectAhead(origin, heading, distanceM);
  return {
    ...point,
    name: "Shoulder ahead",
    address: `${point.lat.toFixed(6)}, ${point.lon.toFixed(6)}`,
    kind: "street",
  };
}
