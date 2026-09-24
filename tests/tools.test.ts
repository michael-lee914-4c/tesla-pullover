import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { commandSucceeded, createMockFleet } from "../src/fleet.ts";
import { createMockPlaces } from "../src/geocode.ts";
import { createPulloverServer } from "../src/server.ts";
import { PULLOVER_TOOL_NAMES, PULLOVER_TOOLS } from "../src/tools.ts";

async function connect() {
  const fleet = createMockFleet();
  const server = createPulloverServer({ fleet, places: createMockPlaces(), waitAfterWakeMs: 0 });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "pullover-test", version: "0.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return { client, fleet, close: () => client.close() };
}

function toolText(result: unknown): string {
  const record = result && typeof result === "object" ? (result as Record<string, unknown>) : {};
  const content = Array.isArray(record.content) ? record.content : [];
  return content
    .map((part) => (typeof part === "object" && part && "text" in part ? String((part as { text?: unknown }).text ?? "") : ""))
    .join("\n");
}

describe("MCP tool registration", () => {
  it("registers the documented tool names", async () => {
    const { client, close } = await connect();
    try {
      const listed = await client.listTools();
      expect(listed.tools.map((tool) => tool.name)).toEqual(PULLOVER_TOOL_NAMES);
      const byName = new Map(listed.tools.map((tool) => [tool.name, tool.description ?? ""]));
      for (const meta of PULLOVER_TOOLS) {
        const description = byName.get(meta.name) ?? "";
        if (meta.needsProxy) expect(description).toMatch(/command proxy/i);
        else expect(description).not.toMatch(/command proxy/i);
      }
    } finally {
      await close();
    }
  });

  it("runs pull_over end-to-end against mock Fleet + mock geocoder", async () => {
    const { client, fleet, close } = await connect();
    try {
      const result = await client.callTool({ name: "pull_over", arguments: { max_distance_m: 1800 } });
      expect(result.isError).toBeUndefined();
      const payload = JSON.parse(toolText(result));
      expect(payload.stop.kind).toBe("parking");
      expect(payload.stop.ahead).toBe(true);
      expect(payload.navigation.method).toBe("navigation_gps_request");
      expect(payload.navigation.order).toBe(1);
      expect(fleet.calls.filter((call) => call.method === "getLocation")).toHaveLength(1);
      expect(fleet.calls.some((call) => call.method === "navigate")).toBe(true);
    } finally {
      await close();
    }
  });

  it("marks pull_over as an error when Fleet returns result:false", async () => {
    const fleet = createMockFleet();
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
    const server = createPulloverServer({ fleet, places: createMockPlaces(), waitAfterWakeMs: 0 });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "pullover-fail-test", version: "0.0.0" });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    try {
      const result = await client.callTool({ name: "pull_over", arguments: {} });
      expect(result.isError).toBe(true);
      const payload = JSON.parse(toolText(result));
      expect(payload.navigation.ok).toBe(false);
      expect(payload.stop.ahead).toBe(true);
    } finally {
      await client.close();
    }
  });

  it("keeps find_safe_stop as a dry-run", async () => {
    const { client, fleet, close } = await connect();
    try {
      const result = await client.callTool({ name: "find_safe_stop", arguments: {} });
      expect(result.isError).toBeUndefined();
      const payload = JSON.parse(toolText(result));
      expect(payload.stop.address).toBeTruthy();
      expect(payload.navigation).toBeUndefined();
      expect(fleet.calls.some((call) => call.method === "navigate")).toBe(false);
    } finally {
      await close();
    }
  });
});
