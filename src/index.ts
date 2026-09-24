import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { serveHttp } from "./http.ts";
import { createPulloverServer } from "./server.ts";

const http = process.argv.includes("--http") || process.env.MCP_TRANSPORT === "http";

if (http) {
  await serveHttp();
} else {
  const transport = new StdioServerTransport();
  await createPulloverServer().connect(transport);
}
