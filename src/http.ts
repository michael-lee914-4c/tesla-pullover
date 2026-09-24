import { timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { env } from "./config.ts";
import { createPulloverServer } from "./server.ts";

export type HttpListen = {
  host: string;
  port: number;
  token: string;
};

function applyCors(res: ServerResponse): void {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Authorization, Content-Type, Accept, mcp-session-id, Last-Event-ID, MCP-Protocol-Version",
  );
  res.setHeader("Access-Control-Expose-Headers", "mcp-session-id");
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  applyCors(res);
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function bearerMatches(header: string | undefined, expected: string): boolean {
  const prefix = "Bearer ";
  if (!header?.startsWith(prefix)) return false;
  const got = Buffer.from(header.slice(prefix.length));
  const want = Buffer.from(expected);
  if (got.length !== want.length) return false;
  return timingSafeEqual(got, want);
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return undefined;
  return JSON.parse(raw);
}

export function httpOptionsFromEnv(): HttpListen {
  const token = env("TESLA_MCP_TOKEN");
  if (!token) throw new Error("Missing TESLA_MCP_TOKEN (required for HTTP MCP)");
  const port = Number(env("TESLA_MCP_PORT", "8787"));
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error("TESLA_MCP_PORT must be an integer 0–65535");
  }
  return { host: env("TESLA_MCP_HOST", "0.0.0.0"), port, token };
}

export function createHttpServer(opts: HttpListen) {
  return createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    applyCors(res);

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.method === "GET" && url.pathname === "/health") {
      sendJson(res, 200, { ok: true, transport: "streamable-http", path: "/mcp" });
      return;
    }

    if (url.pathname !== "/mcp") {
      sendJson(res, 404, { jsonrpc: "2.0", error: { code: -32004, message: "Not found" }, id: null });
      return;
    }

    if (!bearerMatches(req.headers.authorization, opts.token)) {
      res.setHeader("WWW-Authenticate", "Bearer");
      sendJson(res, 401, { jsonrpc: "2.0", error: { code: -32001, message: "Unauthorized" }, id: null });
      return;
    }

    if (req.method !== "POST") {
      sendJson(res, 405, { jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed." }, id: null });
      return;
    }

    const mcp = createPulloverServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    const cleanup = () => {
      void transport.close();
      void mcp.close();
    };
    res.on("close", cleanup);
    if (res.closed) cleanup();

    try {
      const body = await readJsonBody(req);
      await mcp.connect(transport);
      await transport.handleRequest(req, res, body);
    } catch (error) {
      if (!res.headersSent) {
        sendJson(res, 500, {
          jsonrpc: "2.0",
          error: { code: -32603, message: error instanceof Error ? error.message : "Internal server error" },
          id: null,
        });
      }
    }
  });
}

export async function serveHttp(opts: HttpListen = httpOptionsFromEnv()): Promise<{
  url: string;
  close: () => Promise<void>;
}> {
  const httpServer = createHttpServer(opts);
  await new Promise<void>((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(opts.port, opts.host, () => resolve());
  });
  const address = httpServer.address();
  const port = typeof address === "object" && address ? address.port : opts.port;
  const displayHost = opts.host === "0.0.0.0" || opts.host === "::" ? "127.0.0.1" : opts.host;
  const url = `http://${displayHost}:${port}/mcp`;
  console.error(`tesla-pullover Streamable HTTP on ${url}`);
  return {
    url,
    close: () =>
      new Promise((resolve, reject) => {
        httpServer.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}
