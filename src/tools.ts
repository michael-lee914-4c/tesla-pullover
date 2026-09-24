export type PulloverToolKind = "read" | "write";

export type PulloverToolMeta = {
  name: string;
  kind: PulloverToolKind;
  needsProxy: boolean;
};

export const PULLOVER_TOOLS = [
  { name: "pull_over", kind: "write", needsProxy: true },
  { name: "find_safe_stop", kind: "read", needsProxy: false },
  { name: "navigate_to", kind: "write", needsProxy: true },
  { name: "vehicles_list", kind: "read", needsProxy: false },
  { name: "vehicle_location", kind: "read", needsProxy: false },
] as const satisfies readonly PulloverToolMeta[];

export type PulloverToolName = (typeof PULLOVER_TOOLS)[number]["name"];

export const PULLOVER_TOOL_NAMES: PulloverToolName[] = PULLOVER_TOOLS.map((tool) => tool.name);
