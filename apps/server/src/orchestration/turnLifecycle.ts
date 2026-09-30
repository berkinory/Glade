import type { OrchestrationSession } from "@glade/contracts/orchestration/orchestration";

type TurnState = "pending" | "running" | "completed" | "interrupted" | "error";

export function settleTurnStateFromSession(
  session: Pick<OrchestrationSession, "status" | "activeTurnId">,
  existingState: TurnState,
): Exclude<TurnState, "pending" | "running"> | null {
  if (session.activeTurnId !== null && session.status !== "error") {
    return null;
  }

  switch (session.status) {
    case "error":
      return "error";
    case "interrupted":
    case "stopped":
      return "interrupted";
    case "ready":
      return existingState === "error"
        ? "error"
        : existingState === "interrupted"
          ? "interrupted"
          : "completed";
    case "idle":
    case "starting":
    case "running":
      return null;
  }
}

export function maxIso(left: string | null, right: string): string {
  return left === null || right > left ? right : left;
}
