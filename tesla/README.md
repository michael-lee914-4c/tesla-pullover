# tesla-pullover plugin

Thin Grok / Cursor plugin that points at the hosted Streamable HTTP MCP in this repository.

Grok Bot needs a **public HTTPS** `/mcp` URL (no stdio, no localhost). Tesla Fleet and Teslemetry tokens stay in the **server** environment. This plugin only declares `TESLA_MCP_URL` and `TESLA_MCP_TOKEN`.

## Grok Bot

1. Host the MCP (`MCP_TRANSPORT=http npm run start:http`) with public HTTPS on `/mcp`.
2. **New Connector → Custom**, or Plugins → connect `tesla-pullover`.
3. Set `TESLA_MCP_URL` and `TESLA_MCP_TOKEN`.

| Field | Value |
| --- | --- |
| Name | `tesla-pullover` |
| Type | `http` |
| URL | your public `https://…/mcp` |
| Header | `Authorization: Bearer <TESLA_MCP_TOKEN>` |

When the driver says “pull over”, call `pull_over`. Use `find_safe_stop` if they only want a recommendation.

## Cursor

Open this `tesla/` folder as a plugin, then **Settings → Tools & MCP → Connect** `tesla-pullover`. Same two variables as Grok.

Local stdio still works from the repo root via `./run.sh`.
