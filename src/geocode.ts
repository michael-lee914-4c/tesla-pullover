import {
  geocodeProvider,
  geocodeUserAgent,
  googleMapsKey,
  isMockMode,
  maxDistanceM,
  minDistanceM,
} from "./config.ts";
import {
  classifyPlace,
  fallbackShoulder,
  projectAhead,
  rankStops,
  type LatLon,
  type PlaceCandidate,
  type PlaceKind,
  type RankedStop,
} from "./geo.ts";
import { asNumber, asRecord, asString } from "./util.ts";

export type PlaceSearchQuery = {
  origin: LatLon;
  heading: number;
  minDistanceM?: number;
  maxDistanceM?: number;
};

export type PlaceFinder = {
  findStops(query: PlaceSearchQuery): Promise<RankedStop[]>;
};

function headers(): Record<string, string> {
  return { Accept: "application/json", "User-Agent": geocodeUserAgent() };
}

function place(
  name: string,
  address: string,
  lat: number,
  lon: number,
  kind: PlaceKind | string,
): PlaceCandidate {
  return {
    name: name || address || "Unnamed stop",
    address: address || `${lat.toFixed(6)}, ${lon.toFixed(6)}`,
    lat,
    lon,
    kind: typeof kind === "string" ? classifyPlace(kind) : kind,
  };
}

async function googleNearby(center: LatLon, radiusM: number): Promise<PlaceCandidate[]> {
  const key = googleMapsKey();
  if (!key) return [];

  const newApi = await fetch("https://places.googleapis.com/v1/places:searchNearby", {
    method: "POST",
    headers: {
      ...headers(),
      "Content-Type": "application/json",
      "X-Goog-Api-Key": key,
      "X-Goog-FieldMask": "places.displayName,places.formattedAddress,places.location,places.types",
    },
    body: JSON.stringify({
      includedTypes: ["parking", "rest_stop"],
      maxResultCount: 15,
      locationRestriction: {
        circle: { center: { latitude: center.lat, longitude: center.lon }, radius: radiusM },
      },
    }),
  });

  if (newApi.ok) {
    const json = asRecord(await newApi.json());
    const places = Array.isArray(json.places) ? json.places : [];
    return places.flatMap((item) => {
      const row = asRecord(item);
      const location = asRecord(row.location);
      const lat = asNumber(location.latitude);
      const lon = asNumber(location.longitude);
      if (lat === undefined || lon === undefined) return [];
      const types = Array.isArray(row.types) ? row.types.map(String) : [];
      const kind = types.find((type) => classifyPlace(type) !== "other") ?? types[0] ?? "parking";
      const display = asRecord(row.displayName);
      return [
        place(
          asString(display.text) ?? "Parking",
          asString(row.formattedAddress) ?? "",
          lat,
          lon,
          kind,
        ),
      ];
    });
  }

  const legacy = new URL("https://maps.googleapis.com/maps/api/place/nearbysearch/json");
  legacy.searchParams.set("location", `${center.lat},${center.lon}`);
  legacy.searchParams.set("radius", String(Math.round(radiusM)));
  legacy.searchParams.set("type", "parking");
  legacy.searchParams.set("key", key);
  const res = await fetch(legacy, { headers: headers() });
  if (!res.ok) return [];
  const json = asRecord(await res.json());
  const results = Array.isArray(json.results) ? json.results : [];
  return results.flatMap((item) => {
    const row = asRecord(item);
    const geometry = asRecord(row.geometry);
    const loc = asRecord(geometry.location);
    const lat = asNumber(loc.lat);
    const lon = asNumber(loc.lng);
    if (lat === undefined || lon === undefined) return [];
    const types = Array.isArray(row.types) ? row.types.map(String) : ["parking"];
    return [place(asString(row.name) ?? "Parking", asString(row.vicinity) ?? "", lat, lon, types[0] ?? "parking")];
  });
}

async function nominatimReverse(point: LatLon): Promise<PlaceCandidate | undefined> {
  const url = new URL("https://nominatim.openstreetmap.org/reverse");
  url.searchParams.set("lat", String(point.lat));
  url.searchParams.set("lon", String(point.lon));
  url.searchParams.set("format", "jsonv2");
  const res = await fetch(url, { headers: headers() });
  if (!res.ok) return undefined;
  const json = asRecord(await res.json());
  const lat = asNumber(json.lat) ?? point.lat;
  const lon = asNumber(json.lon) ?? point.lon;
  const address = asString(json.display_name);
  if (!address) return undefined;
  return place(asString(json.name) ?? "Side street", address, lat, lon, "street");
}

async function overpassNearby(center: LatLon, radiusM: number): Promise<PlaceCandidate[]> {
  const query = `[out:json][timeout:15];
(
  node["amenity"="parking"](around:${Math.round(radiusM)},${center.lat},${center.lon});
  way["amenity"="parking"](around:${Math.round(radiusM)},${center.lat},${center.lon});
  node["highway"="rest_area"](around:${Math.round(radiusM)},${center.lat},${center.lon});
  node["highway"="services"](around:${Math.round(radiusM)},${center.lat},${center.lon});
  node["amenity"="fuel"](around:${Math.round(radiusM)},${center.lat},${center.lon});
);
out center 25;`;
  const res = await fetch("https://overpass-api.de/api/interpreter", {
    method: "POST",
    headers: { ...headers(), "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ data: query }),
  });
  if (!res.ok) return [];
  const json = asRecord(await res.json());
  const elements = Array.isArray(json.elements) ? json.elements : [];
  return elements.flatMap((item) => {
    const row = asRecord(item);
    const tags = asRecord(row.tags);
    const centerRow = asRecord(row.center);
    const lat = asNumber(row.lat ?? centerRow.lat);
    const lon = asNumber(row.lon ?? centerRow.lon);
    if (lat === undefined || lon === undefined) return [];
    const kindRaw = asString(tags.amenity) ?? asString(tags.highway) ?? "other";
    const name = asString(tags.name) ?? asString(tags.operator) ?? kindRaw;
    return [place(name, name, lat, lon, kindRaw)];
  });
}

export async function searchLivePlaces(query: PlaceSearchQuery): Promise<PlaceCandidate[]> {
  const maxM = query.maxDistanceM ?? maxDistanceM();
  const center = projectAhead(query.origin, query.heading, Math.min(800, maxM * 0.4));
  const provider = geocodeProvider();
  const candidates: PlaceCandidate[] = [];

  const useGoogle = provider === "google" || (provider === "auto" && Boolean(googleMapsKey()));
  if (useGoogle) {
    candidates.push(...(await googleNearby(center, maxM)));
  }
  if (provider === "nominatim" || provider === "auto") {
    if (candidates.length === 0) {
      candidates.push(...(await overpassNearby(query.origin, maxM)));
    }
    const reverse = await nominatimReverse(projectAhead(query.origin, query.heading, Math.min(500, maxM)));
    if (reverse) candidates.push(reverse);
  }

  if (candidates.length === 0) {
    candidates.push(fallbackShoulder(query.origin, query.heading, Math.min(400, maxM)));
  }
  return candidates;
}

export function createHttpPlaces(): PlaceFinder {
  return {
    async findStops(query) {
      const candidates = await searchLivePlaces(query);
      return rankStops(query.origin, query.heading, candidates, {
        minM: query.minDistanceM ?? minDistanceM(),
        maxM: query.maxDistanceM ?? maxDistanceM(),
      });
    },
  };
}

export function createMockPlaces(extra: PlaceCandidate[] = []): PlaceFinder {
  return {
    async findStops(query) {
      const ahead = projectAhead(query.origin, query.heading, 550);
      const behind = projectAhead(query.origin, query.heading + 180, 400);
      const side = projectAhead(query.origin, query.heading + 85, 350);
      const candidates: PlaceCandidate[] = [
        place("Civic Center Garage", "250 Hamilton Ave, Palo Alto, CA", ahead.lat, ahead.lon, "parking"),
        place("Rest area", "US-101 rest area", projectAhead(query.origin, query.heading, 1400).lat, projectAhead(query.origin, query.heading, 1400).lon, "rest_area"),
        place("Gas station behind", "Behind travel", behind.lat, behind.lon, "gas"),
        place("Side street", "Side street address", side.lat, side.lon, "street"),
        ...extra,
      ];
      const ranked = rankStops(query.origin, query.heading, candidates, {
        minM: query.minDistanceM ?? minDistanceM(),
        maxM: query.maxDistanceM ?? maxDistanceM(),
      });
      return ranked;
    },
  };
}

export function createPlaces(): PlaceFinder {
  if (isMockMode() || geocodeProvider() === "mock") return createMockPlaces();
  return createHttpPlaces();
}
