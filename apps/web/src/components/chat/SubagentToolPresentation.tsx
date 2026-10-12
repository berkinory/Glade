import type { WorkLogSubagent, WorkLogSubagentAction } from "~/workLog.types";
import { resolveSubagentPresentation } from "~/lib/subagentPresentation";

export function subagentToolHeading(
  action: WorkLogSubagentAction,
  subagents: ReadonlyArray<WorkLogSubagent>,
  status: string,
): string {
  const names = subagents
    .map(
      (agent) =>
        resolveSubagentPresentation({
          nickname: agent.nickname,
          role: agent.role,
          title: agent.title,
          fallbackId: agent.threadId,
        }).primaryLabel,
    )
    .filter((name) => name !== "Subagent");
  if (names.length === 0) return action.summaryText;
  const target = `${subagents.length === 1 ? "subagent" : "subagents"} ${names.slice(0, 3).join(", ")}${names.length > 3 ? ` +${names.length - 3}` : ""}`;
  const tool = action.tool.toLowerCase().replace(/[^a-z]/g, "");
  const running = status === "running";
  const verb = (() => {
    switch (tool) {
      case "spawnagent":
        return running ? "Spawning" : "Spawned";
      case "wait":
      case "waitagent":
        return running ? "Waiting for" : "Waited for";
      case "sendinput":
        return running ? "Sending instructions to" : "Sent instructions to";
      case "closeagent":
        return running ? "Stopping" : "Stopped";
      case "resumeagent":
        return running ? "Resuming" : "Resumed";
      default:
        return "Updated";
    }
  })();
  return status === "failed" ? `Subagent action failed: ${target}` : `${verb} ${target}`;
}
