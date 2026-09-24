# tesla-pullover

When a driver says **“pull over”** in Grok, this service:

1. Reads the vehicle’s current location and heading from the Tesla Fleet API
2. Finds a safe stop just ahead (parking lot, rest area, or side-street address)
3. Sends a navigation destination so FSD can drive there

It is an MCP server with **Streamable HTTP** (public HTTPS for Grok Bot / Grok) and **stdio** (local Cursor). HTTP is gated with a Bearer token (`TESLA_MCP_TOKEN`). That token is **not** a Fleet or Teslemetry credential.

Vehicle commands go through a **vehicle-command proxy** (`TESLA_COMMAND_BASE`: [tesla-http-proxy](https://github.com/teslamotors/vehicle-command) or Teslemetry). Modern cars reject unsigned Fleet `/command/*` calls.

## Tools

| Tool | What it does |
| --- | --- |
| `pull_over` | Main path. Optional `vin`, optional `max_distance_m`. Returns the chosen stop and the navigation result. |
| `find_safe_stop` | Dry-run: same search, no navigation. |
| `navigate_to` | Send nav to an `address` and/or `lat`/`lon`. Default `order=1` (replace trip). |
| `vehicles_list` | Account vehicles (debug). |
| `vehicle_location` | One cheap `vehicle_get`, optional single wake, then one `vehicle_data?endpoints=location_data;drive_state`. |

`pull_over` never polls `vehicle_data`. It calls `vehicle_get` first. If the car is asleep it wakes **once**, waits, checks `vehicle_get` again, then makes **one** location read. If the car is still asleep it returns an error instead of looping.

Navigation prefers `POST .../command/navigation_gps_request` with coordinates and `order=1`. If the proxy rejects that command (some `tesla-http-proxy` builds do), it falls back to `navigation_request` share-to-car text (address or `"lat, lon"`).

## Requirements

- Node 20+
- A Tesla developer application ([dashboard](https://developer.tesla.com/dashboard))
- An HTTPS hostname **you own**. The hostname **must not contain the word `tesla`**.
- Public key hosted at `https://your.domain/.well-known/appspecific/com.tesla.3p.public-key.pem`
- Partner registration (`POST /api/1/partner_accounts`) in each Fleet region you use
- Virtual key paired on the car
- `tesla-http-proxy` on **localhost only**, or a Teslemetry account
- Optional Google Maps / Places key (Nominatim + Overpass work without a key)
- Payment method + billing limit on the Tesla developer app (Fleet is pay-as-you-go)

## Environment

Copy `env.example` to `.env`. Point `TESLA_CACHE_PATH` at a `0600` file **outside git**. Never commit secrets, tokens, VINs, or private keys.

| Variable | Required | Meaning |
| --- | --- | --- |
| `TESLA_CLIENT_ID` | OAuth | Developer app client id |
| `TESLA_CLIENT_SECRET` | OAuth | Developer app secret |
| `TESLA_REDIRECT_URI` | OAuth | Must match the app’s allowed redirect (`https://your.domain/callback`) |
| `TESLA_AUDIENCE` | OAuth | Fleet origin for your region |
| `TESLA_REGION` | no | `na` (default), `eu`, or `cn` |
| `TESLA_FLEET_BASE` | no | Override Fleet origin |
| `TESLA_CACHE_PATH` | no | Token cache (default `./token-cache.json`) |
| `TESLA_ACCESS_TOKEN` | Teslemetry | Skip OAuth if you already have an owner token |
| `TESLA_VIN` | no | Default vehicle when tools omit `vin` |
| `TESLA_COMMAND_BASE` | nav | Proxy origin, e.g. `https://127.0.0.1:4443` or Teslemetry |
| `NODE_EXTRA_CA_CERTS` | proxy TLS | CA for a self-signed localhost proxy cert |
| `GOOGLE_MAPS_API_KEY` | no | Places search; otherwise OSM / Nominatim |
| `GEOCODE_PROVIDER` | no | `auto` (default), `google`, `nominatim`, `mock` |
| `PULLOVER_MIN_DISTANCE_M` | no | Default `200` |
| `PULLOVER_MAX_DISTANCE_M` | no | Default `2000` |
| `TESLA_WAKE_WAIT_MS` | no | Single wait after wake (default `8000`). Not a `vehicle_data` loop. |
| `TESLA_MCP_TOKEN` | HTTP | Bearer gate for Streamable HTTP |
| `TESLA_MCP_HOST` | HTTP | Bind address (default `0.0.0.0`) |
| `TESLA_MCP_PORT` | HTTP | Bind port (default `8787`) |
| `MCP_TRANSPORT` | HTTP | Set `http` to start Streamable HTTP instead of stdio |
| `TESLA_MOCK` | tests | `1` enables mock Fleet + mock geocoder |

## Tesla developer app and pairing (once)

1. Create the app. Grant type: authorization code **and** machine-to-machine.
2. Allowed origin: `https://your.domain`. Allowed redirect: `https://your.domain/callback`.
3. Scopes: `openid`, `offline_access`, `vehicle_device_data`, `vehicle_cmds`, `vehicle_location`.
4. Generate a P-256 key pair:

```bash
openssl ecparam -name prime256v1 -genkey -noout -out private-key.pem
openssl ec -in private-key.pem -pubout -out public-key.pem
```

Host **only** the public key at:

`https://your.domain/.well-known/appspecific/com.tesla.3p.public-key.pem`

Confirm that URL returns `200` with the PEM body and **no redirect**. Do not host `private-key.pem`.

5. Register the partner account in each region you use (North America example):

```bash
# partner token
curl -s --data-urlencode grant_type=client_credentials \
  --data-urlencode client_id="$TESLA_CLIENT_ID" \
  --data-urlencode client_secret="$TESLA_CLIENT_SECRET" \
  --data-urlencode audience="$TESLA_AUDIENCE" \
  --data-urlencode scope='openid vehicle_device_data vehicle_cmds vehicle_location' \
  https://fleet-auth.prd.vn.cloud.tesla.com/oauth2/v3/token

# then POST {"domain":"your.domain"} to $TESLA_AUDIENCE/api/1/partner_accounts
# with Authorization: Bearer <partner access_token>
```

6. User login (owner of the car):

```bash
set -a && source .env && set +a
npm install
npm run login
# open the printed URL, approve, paste the full https://your.domain/callback?code=... URL:
npm run login -- "https://your.domain/callback?code=...."
```

The callback host only needs to accept the browser hit; this CLI reads the URL you paste. A blank page is fine.

7. Pair the virtual key (Tesla app, car online): `https://tesla.com/_ak/your.domain`

### tesla-http-proxy (localhost only)

Model 3 / Y and recent S/X require the [Vehicle Command Protocol](https://github.com/teslamotors/vehicle-command). Unsigned Fleet command calls are rejected.

1. Run `tesla-http-proxy` with your **private** key and TLS, bound to **127.0.0.1**.
2. Set `TESLA_COMMAND_BASE=https://127.0.0.1:4443`.
3. If the proxy cert is self-signed, set `NODE_EXTRA_CA_CERTS` to that cert.

**Do not publish the proxy.** Do not put it on the same public hostname as `/mcp`. This repo does not vendor or start that binary.

### Teslemetry

Set `TESLA_ACCESS_TOKEN` to your Teslemetry token and point both `TESLA_FLEET_BASE` and `TESLA_COMMAND_BASE` at Teslemetry’s Fleet-compatible origin. You can skip the local proxy and `npm run login` in that setup.

## Geocoding

Given lat/lon/heading, the finder searches **ahead of travel** for parking, rest areas, and a reverse-geocoded side street. Ranking prefers:

- Ahead of the heading (90° cone)
- Short distance in the 200 m–2 km band (overridable)
- Type: parking and rest area over gas / generic street

If no key is set, Overpass + Nominatim are used. If nothing is found, a projected “shoulder ahead” coordinate is returned so navigation still has a target.

## Run

### Mock / dry-run (no Tesla credentials)

```bash
TESLA_MOCK=1 npm test
TESLA_MOCK=1 TESLA_MCP_TOKEN=dev-token MCP_TRANSPORT=http npm run start:http
```

### Streamable HTTP (Grok Bot)

Public URL must be **HTTPS**, not localhost. The hostname must not contain the word `tesla`.

```bash
export TESLA_MCP_TOKEN   # long random secret; same value you give Grok
MCP_TRANSPORT=http npm run start:http
# Bind stays on this machine. Expose only /mcp:
cloudflared tunnel --url http://127.0.0.1:8787
```

Point the tunnel (or your reverse proxy) at `http://127.0.0.1:8787`. Keep `tesla-http-proxy` on localhost.

### Local Cursor / stdio

```bash
chmod +x run.sh
./run.sh
```

`run.sh` sources `.env` in the repo directory, or `$TESLA_ENV` if set.

## Grok Bot connector

1. Host Streamable HTTP and expose `https://your.domain/mcp`.
2. In Grok Bot: **New Connector → Custom** (or Plugins → connect `tesla-pullover` if you loaded the plugin in [`tesla/`](tesla/)).

| Field | Value |
| --- | --- |
| Name | `tesla-pullover` |
| Type | `http` |
| URL | your public `https://…/mcp` |
| Header | `Authorization: Bearer <TESLA_MCP_TOKEN>` |

3. Set plugin variables `TESLA_MCP_URL` and `TESLA_MCP_TOKEN` to the same public URL and bearer. Fleet / Teslemetry secrets stay in the **server** environment, never in Grok.

Then: “pull over” → Grok should call `pull_over`.

### Grok Build

```text
/plugin
```

or install from [`tesla/.grok-plugin/plugin.json`](tesla/.grok-plugin/plugin.json). MCP config: [`tesla/.mcp.json`](tesla/.mcp.json).

### Cursor

Open [`tesla/`](tesla/) as a plugin, or add an HTTP MCP entry with the same URL + bearer. Local stdio still works via `./run.sh`.

## Dev

```bash
npm install
npm test
npx tsc --noEmit
```

Tests run in mock mode (`TESLA_MOCK=1`) against in-memory Fleet + geocoder. They cover heading/distance ranking and MCP tool registration, including an end-to-end `pull_over`.

## License

MIT. See [LICENSE](LICENSE).
