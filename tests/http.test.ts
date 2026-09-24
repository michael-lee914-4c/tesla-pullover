import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { serveHttp } from "../src/http.ts";
import { PULLOVER_TOOL_NAMES } from "../src/tools.ts";

const TOKEN = "test-pullover-mcp-token";

describe("streamable HTTP", () => {
  let url = "";
  let close: () => Promise<void> = async () => {};

  beforeAll(async () => {
    const server = await serveHttp({ host: "127.0.0.1", port: 0, token: TOKEN });
    url = server.url;
    close = server.close;
  });

  afterAll(async () => {
    await close();
  });

  it("serves /health and rejects a missing bearer", async () => {
    const health = await fetch(url.replace(/\/mcp$/, "/health"));
    expect(health.status).toBe(200);
    expect(await health.json()).toMatchObject({ ok: true, path: "/mcp" });

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
    });
    expect(res.status).toBe(401);
  });

  it("lists tools and runs pull_over in mock mode", async () => {
    const transport = new StreamableHTTPClientTransport(new URL(url), {
      requestInit: { headers: { Authorization: `Bearer ${TOKEN}` } },
    });
    const client = new Client({ name: "pullover-http-test", version: "0.0.0" });
    await client.connect(transport);
    try {
      const listed = await client.listTools();
      expect(listed.tools.map((tool) => tool.name)).toEqual(PULLOVER_TOOL_NAMES);

      const result = await client.callTool({ name: "pull_over", arguments: {} });
      expect(result.isError).toBeUndefined();
      const text = (result.content as { type: string; text?: string }[]).map((part) => part.text ?? "").join("\n");
      const payload = JSON.parse(text);
      expect(payload.navigation.method).toBe("navigation_gps_request");
      expect(payload.stop.lat).toEqual(expect.any(Number));
    } finally {
      await client.close();
    }
  });
});
