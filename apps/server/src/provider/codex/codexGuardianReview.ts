import type { ItemGuardianApprovalReviewCompletedNotification } from "./protocol/generated/types/v2/ItemGuardianApprovalReviewCompletedNotification";
import type { GuardianApprovalReviewAction } from "./protocol/generated/types/v2/GuardianApprovalReviewAction";

// The app-server notification uses camelCase; the override accepts a Rust protocol event.
function nativeAction(action: GuardianApprovalReviewAction) {
  switch (action.type) {
    case "command":
    case "execve":
      return {
        ...action,
        source: action.source === "unifiedExec" ? "unified_exec" : action.source,
      };
    case "writeStdin":
      return {
        type: "write_stdin",
        approval_id: action.approvalId,
        process_id: action.processId,
        stdin: action.stdin,
        cwd: action.cwd,
      };
    case "applyPatch":
      return { ...action, type: "apply_patch" };
    case "networkAccess":
      return {
        ...action,
        type: "network_access",
        protocol:
          action.protocol === "socks5Tcp"
            ? "socks5_tcp"
            : action.protocol === "socks5Udp"
              ? "socks5_udp"
              : action.protocol,
      };
    case "mcpToolCall":
      return {
        type: "mcp_tool_call",
        server: action.server,
        tool_name: action.toolName,
        connector_id: action.connectorId,
        connector_name: action.connectorName,
        tool_title: action.toolTitle,
      };
    case "requestPermissions": {
      const files = action.permissions.fileSystem;
      return {
        type: "request_permissions",
        reason: action.reason,
        permissions: {
          network: action.permissions.network,
          file_system: files
            ? {
                read: files.read,
                write: files.write,
                entries: files.entries,
                glob_scan_max_depth: files.globScanMaxDepth,
              }
            : null,
        },
      };
    }
  }
}

export function guardianDeniedEvent(review: ItemGuardianApprovalReviewCompletedNotification) {
  if (review.review.status !== "denied") throw new Error("Only denied actions can be overridden.");
  return {
    id: review.reviewId,
    turn_id: review.turnId,
    started_at_ms: review.startedAtMs,
    completed_at_ms: review.completedAtMs,
    target_item_id: review.targetItemId,
    status: "denied",
    risk_level: review.review.riskLevel,
    user_authorization: review.review.userAuthorization,
    rationale: review.review.rationale,
    decision_source: review.decisionSource,
    action: nativeAction(review.action),
  };
}

export type GuardianDeniedEvent = ReturnType<typeof guardianDeniedEvent>;
