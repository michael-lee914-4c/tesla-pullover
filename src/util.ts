export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function qs(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") search.set(key, String(value));
  }
  const serialized = search.toString();
  return serialized ? `?${serialized}` : "";
}

/** Tesla Fleet ignores comma-separated `endpoints` (metadata only). Use `;`. */
export function endpointsQuery(raw?: string): string {
  if (raw === undefined) return "";
  const parts = raw
    .split(/[,;]+/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) return "";
  return qs({ endpoints: parts.join(";") });
}

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export function asNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

export function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function toolText(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

export async function runTool(fn: () => Promise<unknown>, failed?: (data: unknown) => boolean) {
  try {
    const data = await fn();
    const body = toolText(data);
    return failed?.(data) ? { ...body, isError: true } : body;
  } catch (error) {
    return {
      content: [{ type: "text" as const, text: error instanceof Error ? error.message : String(error) }],
      isError: true,
    };
  }
}
