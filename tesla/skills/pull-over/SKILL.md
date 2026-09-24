# pull-over

When the driver says "pull over", "find a safe stop", or "navigate off the road":

1. Call `pull_over` (optional `vin`, optional `max_distance_m`).
2. Tell them the chosen address, distance, and that navigation was sent (`order=1` replaces the current trip).
3. If they only want a recommendation, call `find_safe_stop` instead.
4. If they already have an address or coordinates, call `navigate_to`.

Do not poll `vehicle_data`. Do not send Tesla Fleet tokens to the user. The HTTP connector only uses `TESLA_MCP_URL` and `TESLA_MCP_TOKEN`.
