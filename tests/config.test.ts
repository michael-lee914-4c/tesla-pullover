import { afterEach, describe, expect, it } from "vitest";
import { endpointsQuery } from "../src/util.ts";
import { extractLocation, navigationGpsBody, navigationShareBody } from "../src/fleet.ts";
import { fleetBase, isMockMode, region } from "../src/config.ts";

const restore: Array<() => void> = [];

function stash(name: string, value: string | undefined) {
  const prev = process.env[name];
  restore.push(() => {
    if (prev === undefined) delete process.env[name];
    else process.env[name] = prev;
  });
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

afterEach(() => {
  while (restore.length) restore.pop()?.();
});

describe("config and Fleet helpers", () => {
  it("is in mock mode during tests", () => {
    expect(isMockMode()).toBe(true);
  });

  it("rewrites endpoints commas to semicolons", () => {
    expect(endpointsQuery("location_data,drive_state")).toBe("?endpoints=location_data%3Bdrive_state");
    expect(endpointsQuery("location_data;drive_state")).toBe("?endpoints=location_data%3Bdrive_state");
  });

  it("reads NA/EU Fleet origins", () => {
    stash("TESLA_FLEET_BASE", undefined);
    stash("TESLA_REGION", "eu");
    expect(region()).toBe("eu");
    expect(fleetBase()).toContain("prd.eu");
  });

  it("extracts location from drive_state or location_data", () => {
    const loc = extractLocation(
      {
        response: {
          drive_state: { heading: 12 },
          location_data: { latitude: 37.5, longitude: -122.2 },
        },
      },
      "MOCKVIN000000001",
    );
    expect(loc).toMatchObject({ lat: 37.5, lon: -122.2, heading: 12 });
  });

  it("builds navigation bodies with order=1 and share-to-car text", () => {
    expect(navigationGpsBody(37.4, -122.1, 1)).toEqual({
      lat: 37.4,
      lon: -122.1,
      order: 1,
      gps: { latitude: 37.4, longitude: -122.1 },
    });
    const share = navigationShareBody("1 Main St");
    expect(share.type).toBe("share_ext_content_raw");
    expect(share.value).toEqual({ "android.intent.extra.TEXT": "1 Main St" });
  });
});
