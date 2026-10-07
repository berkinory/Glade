import type { ToolLifecycleItemType } from "@glade/contracts/provider/runtimeMetadata";
import { extractToolArgumentField } from "./toolArgumentSummary";

export function normalizeCompactToolLabel(value: string): string {
  return value
    .trimEnd()
    .replace(/\s(?:complete|completed|done|finished|success|succeeded|started|running)$/i, "")
    .trim();
}

export function normalizeToolTextForComparison(value: string | undefined): string {
  return normalizeCompactToolLabel(value ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

const WEB_FETCH_TOOL_NAMES = new Set(["webfetch", "fetch", "urlfetch", "fetchurl", "httpfetch"]);

function isWebFetchToolName(toolName: string | null | undefined): boolean {
  if (!toolName) {
    return false;
  }
  const normalized = toolName.toLowerCase().replace(/[^a-z]/g, "");
  if (WEB_FETCH_TOOL_NAMES.has(normalized)) {
    return true;
  }
  return (
    normalized.includes("fetch") &&
    (normalized.includes("web") || normalized.includes("url") || normalized.includes("http"))
  );
}

export function extractWebFetchUrl(input: {
  readonly toolName?: string | null | undefined;
  readonly detail?: string | null | undefined;
}): string | null {
  if (!isWebFetchToolName(input.toolName)) {
    return null;
  }
  const detail = input.detail;
  if (!detail) {
    return null;
  }
  const candidate =
    extractToolArgumentField(detail, ["url", "uri"]) ??
    /https?:\/\/[^\s"'<>)\]}]+/i.exec(detail)?.[0]?.replace(/[.,;:!?]+$/, "");
  if (candidate && /^https?:\/\//i.test(candidate)) {
    return candidate;
  }
  return null;
}

export function humanizeMcpToolIdentifier(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed.startsWith("mcp__")) {
    return null;
  }

  const [, server, tool, ...rest] = trimmed.split("__");
  const normalizedServer = humanizeMcpToken(server);
  const normalizedTool = [tool, ...rest]
    .map((part) => humanizeMcpToken(part))
    .filter((part) => part.length > 0)
    .join(" ");

  if (!normalizedServer || !normalizedTool) {
    return null;
  }
  return `${normalizedServer}: ${normalizedTool}`;
}

export function humanizeMcpServerTool(server: string, tool: string): string | null {
  const normalizedServer = humanizeMcpToken(server);
  const normalizedTool = humanizeMcpToken(tool);
  if (!normalizedServer || !normalizedTool) {
    return null;
  }
  return `${normalizedServer}: ${normalizedTool}`;
}

export interface ReadableToolTitleInput {
  readonly title?: string | null;
  readonly fallbackLabel: string;
  readonly itemType?: ToolLifecycleItemType | undefined;
  readonly requestKind?:
    | "command"
    | "file-read"
    | "file-change"
    | "permissions"
    | "tool"
    | undefined;
  readonly command?: string | null;
  readonly payload?: Record<string, unknown> | null;
  readonly isRunning?: boolean;
}

export interface GladeMcpToolPresentation {
  readonly running: string;
  readonly completed: string;
  readonly failed: string;
}

export const GLADE_MCP_TOOL_PRESENTATIONS = {
  glade_html_preview: {
    running: "Previewing visual",
    completed: "Previewed visual",
    failed: "Couldn't preview visual",
  },
  glade_html_render: {
    running: "Creating visual",
    completed: "Created visual",
    failed: "Couldn't create visual",
  },
  glade_context: {
    running: "Glade is checking its context",
    completed: "Glade checked its context",
    failed: "Glade couldn't check its context",
  },
  glade_capabilities: {
    running: "Checking available models and subagents",
    completed: "Checked available models and subagents",
    failed: "Couldn't check available models and subagents",
  },
  glade_overview: {
    running: "Glade is gathering an overview",
    completed: "Glade gathered an overview",
    failed: "Glade couldn't gather an overview",
  },
  glade_list_allowed_projects: {
    running: "Glade is listing allowed projects",
    completed: "Glade listed allowed projects",
    failed: "Glade couldn't list allowed projects",
  },
  glade_create_task: {
    running: "Glade is creating a task",
    completed: "Glade created a task",
    failed: "Glade couldn't create a task",
  },
  glade_wait_for_task: {
    running: "Glade is waiting for a task",
    completed: "Glade finished waiting for a task",
    failed: "Glade couldn't wait for a task",
  },
  glade_read_task: {
    running: "Glade is reading a task",
    completed: "Glade read a task",
    failed: "Glade couldn't read a task",
  },
  glade_list_projects: {
    running: "Glade is listing projects",
    completed: "Glade listed projects",
    failed: "Glade couldn't list projects",
  },
  glade_list_threads: {
    running: "Glade is listing threads",
    completed: "Glade listed threads",
    failed: "Glade couldn't list threads",
  },
  glade_read_thread: {
    running: "Glade is reading a thread",
    completed: "Glade read a thread",
    failed: "Glade couldn't read a thread",
  },
  glade_read_thread_activity: {
    running: "Glade is reading thread activity",
    completed: "Glade read thread activity",
    failed: "Glade couldn't read thread activity",
  },
  glade_read_thread_events: {
    running: "Glade is reading thread events",
    completed: "Glade read thread events",
    failed: "Glade couldn't read thread events",
  },
  glade_read_thread_runtime_events: {
    running: "Glade is reading thread runtime events",
    completed: "Glade read thread runtime events",
    failed: "Glade couldn't read thread runtime events",
  },
  glade_diagnose_thread: {
    running: "Glade is diagnosing a thread",
    completed: "Glade diagnosed a thread",
    failed: "Glade couldn't diagnose a thread",
  },
  glade_create_thread: {
    running: "Glade is creating a thread",
    completed: "Glade created a thread",
    failed: "Glade couldn't create a thread",
  },
  glade_create_threads: {
    running: "Glade is creating threads",
    completed: "Glade created threads",
    failed: "Glade couldn't create threads",
  },
  glade_wait_for_threads: {
    running: "Glade is waiting for threads",
    completed: "Glade finished waiting for threads",
    failed: "Glade couldn't wait for threads",
  },
  glade_send_message: {
    running: "Glade is sending a message",
    completed: "Glade sent a message",
    failed: "Glade couldn't send a message",
  },
  glade_interrupt_thread: {
    running: "Glade is interrupting a thread",
    completed: "Glade interrupted a thread",
    failed: "Glade couldn't interrupt a thread",
  },
  glade_set_thread_title: {
    running: "Glade is renaming a thread",
    completed: "Glade renamed a thread",
    failed: "Glade couldn't rename a thread",
  },
  glade_set_thread_archived: {
    running: "Glade is updating a thread",
    completed: "Glade updated a thread",
    failed: "Glade couldn't update a thread",
  },
} as const satisfies Record<string, GladeMcpToolPresentation>;

export function normalizeGladeMcpIdentifier(value: string): string {
  return value
    .replace(/\bglade\b/gi, "glade")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export const GLADE_MCP_TOOL_PRESENTATION_ENTRIES = Object.entries(GLADE_MCP_TOOL_PRESENTATIONS).map(
  ([toolName, presentation]) => ({
    toolName,
    presentation,
    normalizedRunning: normalizeGladeMcpIdentifier(presentation.running),
    normalizedCompleted: normalizeGladeMcpIdentifier(presentation.completed),
    normalizedFailed: normalizeGladeMcpIdentifier(presentation.failed),
  }),
);

export function extractGladeMcpToolName(normalizedCandidate: string): string | null {
  if (normalizedCandidate === "html_preview" || normalizedCandidate === "html_render") {
    return `glade_${normalizedCandidate}`;
  }
  if (normalizedCandidate.startsWith("mcp_glade_glade_")) {
    return normalizedCandidate.slice("mcp_glade_".length);
  }
  if (normalizedCandidate.startsWith("mcp_glade_")) {
    return `glade_${normalizedCandidate.slice("mcp_glade_".length)}`;
  }
  if (normalizedCandidate.startsWith("glade_glade_")) {
    return normalizedCandidate.slice("glade_".length);
  }
  if (normalizedCandidate.startsWith("glade_")) {
    return normalizedCandidate;
  }
  return null;
}

export function fallbackGladeMcpToolPresentation(toolName: string): GladeMcpToolPresentation {
  const action =
    toolName
      .replace(/^glade_/, "")
      .replace(/_+/g, " ")
      .trim() || "an action";
  return {
    running: `Glade is handling ${action}`,
    completed: `Glade handled ${action}`,
    failed: `Glade couldn't handle ${action}`,
  };
}

export function humanizeMcpToken(value: string | undefined): string {
  if (!value) {
    return "";
  }
  const normalized = value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) {
    return "";
  }

  return normalized
    .split(" ")
    .map((token) => {
      const lower = token.toLowerCase();
      if (lower === "mcp") return "MCP";
      if (token.toUpperCase() === token && token.length <= 5) return token;
      return `${lower.charAt(0).toUpperCase()}${lower.slice(1)}`;
    })
    .join(" ");
}
