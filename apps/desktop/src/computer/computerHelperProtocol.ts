import type { DesktopComputerPermissionGuideState } from "@glade/contracts/ipc/ipc";
export type ComputerHelperMessage =
  | {
      type: "permissions";
      accessibility?: "granted" | "denied";
      inputMonitoring?: "granted" | "denied";
      screenRecording?: "granted" | "denied";
    }
  | { type: "ready" }
  | { type: "escape"; capturedAt?: string }
  | {
      type: "physical-input";
      kind: "keyboard" | "pointer";
      pid?: number;
      windowId?: number;
      capturedAt?: string;
    }
  | { type: "escape-monitor-state"; armed: boolean; capturedAt?: string }
  | { type: "permission-guide"; state: DesktopComputerPermissionGuideState }
  | {
      type: "release-held-input";
      released?: boolean;
      reason?: string;
      details?: string[];
    }
  | {
      type: "error";
      id?: string;
      code: string;
      message: string;
      capturedAt?: string;
      requestId?: string;
    };

function isPermission(value: unknown): value is "granted" | "denied" {
  return value === "granted" || value === "denied";
}

export function parseComputerHelperMessage(line: string): ComputerHelperMessage | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const value = parsed as Record<string, unknown>;

  if (value.type === "permissions") {
    const permissions: Extract<ComputerHelperMessage, { type: "permissions" }> = {
      type: "permissions",
      ...(isPermission(value.accessibility) ? { accessibility: value.accessibility } : {}),
      ...(isPermission(value.inputMonitoring) ? { inputMonitoring: value.inputMonitoring } : {}),
      ...(isPermission(value.screenRecording) ? { screenRecording: value.screenRecording } : {}),
    };
    if (
      permissions.accessibility !== undefined ||
      permissions.inputMonitoring !== undefined ||
      permissions.screenRecording !== undefined
    ) {
      return permissions;
    }
    return null;
  }
  if (value.type === "ready") return { type: "ready" };
  if (value.type === "escape") {
    return {
      type: "escape",
      ...(typeof value.capturedAt === "string" ? { capturedAt: value.capturedAt } : {}),
    };
  }
  if (value.type === "escape-monitor-state" && typeof value.armed === "boolean") {
    return {
      type: "escape-monitor-state",
      armed: value.armed,
      ...(typeof value.capturedAt === "string" ? { capturedAt: value.capturedAt } : {}),
    };
  }
  if (value.type === "physical-input" && (value.kind === "keyboard" || value.kind === "pointer")) {
    return {
      type: "physical-input",
      kind: value.kind,
      ...(typeof value.pid === "number" &&
      Number.isSafeInteger(value.pid) &&
      value.pid > 0 &&
      value.pid <= 0x7fffffff
        ? { pid: value.pid }
        : {}),
      ...(typeof value.windowId === "number" &&
      Number.isSafeInteger(value.windowId) &&
      value.windowId > 0 &&
      value.windowId <= 0xffffffff
        ? { windowId: value.windowId }
        : {}),
      ...(typeof value.capturedAt === "string" ? { capturedAt: value.capturedAt } : {}),
    };
  }
  if (
    value.type === "error" &&
    typeof value.code === "string" &&
    value.code.length > 0 &&
    typeof value.message === "string" &&
    value.message.length > 0
  ) {
    return {
      type: "error",
      code: value.code,
      message: value.message,
      ...(typeof value.id === "string" && value.id.length > 0 ? { id: value.id } : {}),
      ...(typeof value.capturedAt === "string" ? { capturedAt: value.capturedAt } : {}),
      ...(typeof value.requestId === "string" && value.requestId.length > 0
        ? { requestId: value.requestId }
        : {}),
    };
  }
  if (
    value.type === "permission-guide" &&
    (value.state === "closed" || value.state === "granted")
  ) {
    return { type: "permission-guide", state: value.state };
  }
  return null;
}
