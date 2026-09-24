import { describe, expect, it } from "vitest";
import {
  bearingDeg,
  classifyPlace,
  distanceScore,
  fallbackShoulder,
  haversineM,
  headingDeltaDeg,
  isAhead,
  projectAhead,
  rankStops,
  type PlaceCandidate,
} from "../src/geo.ts";

const origin = { lat: 37.4419, lon: -122.143 };

describe("pull-over geometry", () => {
  it("projects east along heading 90 and measures ~500m", () => {
    const dest = projectAhead(origin, 90, 500);
    expect(dest.lon).toBeGreaterThan(origin.lon);
    expect(Math.abs(dest.lat - origin.lat)).toBeLessThan(0.001);
    expect(haversineM(origin, dest)).toBeCloseTo(500, 0);
    expect(headingDeltaDeg(90, bearingDeg(origin, dest))).toBeLessThan(2);
  });

  it("treats a point behind the heading as not ahead", () => {
    const behind = projectAhead(origin, 270, 400);
    expect(isAhead(90, bearingDeg(origin, behind))).toBe(false);
    expect(headingDeltaDeg(90, bearingDeg(origin, behind))).toBeGreaterThan(170);
  });

  it("scores the 200m–2km band higher than too-close or far-edge stops", () => {
    expect(distanceScore(600, 200, 2000)).toBeGreaterThan(distanceScore(80, 200, 2000));
    expect(distanceScore(600, 200, 2000)).toBeGreaterThan(distanceScore(1900, 200, 2000));
    expect(distanceScore(2500, 200, 2000)).toBe(0);
  });

  it("classifies pull-off types", () => {
    expect(classifyPlace("parking")).toBe("parking");
    expect(classifyPlace("rest_area")).toBe("rest_area");
    expect(classifyPlace("gas_station")).toBe("gas");
    expect(classifyPlace("residential")).toBe("street");
  });

  it("ranks ahead parking over behind gas and a side street", () => {
    const ahead = projectAhead(origin, 90, 550);
    const rest = projectAhead(origin, 90, 1300);
    const behind = projectAhead(origin, 270, 400);
    const side = projectAhead(origin, 175, 350);
    const candidates: PlaceCandidate[] = [
      { name: "Garage", address: "1 Main", kind: "parking", ...ahead },
      { name: "Rest", address: "Rest", kind: "rest_area", ...rest },
      { name: "Gas", address: "Gas", kind: "gas", ...behind },
      { name: "Side", address: "Side", kind: "street", ...side },
    ];
    const ranked = rankStops(origin, 90, candidates, { minM: 200, maxM: 2000 });
    expect(ranked[0]?.kind).toBe("parking");
    expect(ranked[0]?.ahead).toBe(true);
    expect(ranked.some((stop) => stop.kind === "gas" && !stop.ahead)).toBe(true);
    expect(ranked.findIndex((stop) => stop.kind === "parking")).toBeLessThan(
      ranked.findIndex((stop) => stop.kind === "street"),
    );
  });

  it("drops behind-only candidates so a shoulder ahead can be synthesized", () => {
    const behind = projectAhead(origin, 270, 400);
    const ranked = rankStops(
      origin,
      90,
      [{ name: "Just passed rest area", address: "behind", kind: "rest_area", ...behind }],
      { minM: 200, maxM: 2000 },
    );
    expect(ranked).toEqual([]);
  });

  it("drops candidates beyond max distance and synthesizes a shoulder fallback", () => {
    const far = projectAhead(origin, 90, 5000);
    const ranked = rankStops(
      origin,
      90,
      [{ name: "Too far", address: "far", kind: "parking", ...far }],
      { minM: 200, maxM: 2000 },
    );
    expect(ranked).toEqual([]);
    const shoulder = fallbackShoulder(origin, 90, 400);
    expect(haversineM(origin, shoulder)).toBeCloseTo(400, 0);
    expect(shoulder.kind).toBe("street");
  });
});
