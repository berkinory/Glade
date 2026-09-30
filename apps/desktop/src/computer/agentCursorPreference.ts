import * as FS from "node:fs";
import * as Path from "node:path";

export interface AgentCursorStylePreference {
  readonly fill?: string;
  readonly rim?: string;
  readonly shadow?: string;
}

interface PersistedAgentCursorPreference {
  readonly version: 1;
  readonly style: AgentCursorStylePreference | null;
}

const AGENT_CURSOR_COLOR_PATTERN = /^#[0-9a-f]{6}$/;

function normalizeChannel(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const candidate = value.trim().toLowerCase();
  return AGENT_CURSOR_COLOR_PATTERN.test(candidate) ? candidate : undefined;
}

export function normalizeAgentCursorStylePreference(
  value: unknown,
): AgentCursorStylePreference | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  const fill = normalizeChannel(candidate.fill);
  const rim = normalizeChannel(candidate.rim);
  const shadow = normalizeChannel(candidate.shadow);
  if (!fill && !rim && !shadow) return null;
  return {
    ...(fill ? { fill } : {}),
    ...(rim ? { rim } : {}),
    ...(shadow ? { shadow } : {}),
  };
}

function parseAgentCursorPreference(value: unknown): PersistedAgentCursorPreference | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  if (candidate.version !== 1 || !("style" in candidate)) return null;
  return { version: 1, style: normalizeAgentCursorStylePreference(candidate.style) };
}

export function readAgentCursorPreference(filePath: string): AgentCursorStylePreference | null {
  try {
    const parsed = parseAgentCursorPreference(JSON.parse(FS.readFileSync(filePath, "utf8")));
    return parsed?.style ?? null;
  } catch {
    return null;
  }
}

export function writeAgentCursorPreference(
  filePath: string,
  style: AgentCursorStylePreference | null | undefined,
): void {
  const normalized = normalizeAgentCursorStylePreference(style);
  if (!normalized) {
    FS.rmSync(filePath, { force: true });
    return;
  }
  const payload: PersistedAgentCursorPreference = { version: 1, style: normalized };
  FS.mkdirSync(Path.dirname(filePath), { recursive: true });
  FS.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}
