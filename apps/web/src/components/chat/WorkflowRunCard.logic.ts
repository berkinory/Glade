import { formatEffortLabel } from "@glade/shared/provider/effortLabel";
import { asNonEmptyString } from "@glade/shared/text/text";
import { asFiniteNumber } from "@glade/shared/transport/payloadValues";
import { asObjectRecord } from "@glade/shared/transport/payloadValues";
import { ThreadId } from "@glade/contracts/core/baseSchemas";
import { type OrchestrationThreadActivity } from "@glade/contracts/orchestration/threadEntities";

import { orderedActivities } from "../../workLog.entries";
import { formatSubagentModelLabel, type SubagentStatusKind } from "../../lib/subagentPresentation";

export interface WorkflowAgentRow {
  taskId: string;
  description: string;
  subagentType: string | null;
  phase: string | null;
  statusKind: SubagentStatusKind;
  statusLabel: string;
  totalTokens: number | null;
  toolCalls: number | null;

  durationMs: number | null;
  startedAt: string;
  threadId: ThreadId | null;

  model: string | null;
  modelLabel: string | undefined;

  effortLabel: string | null;
  promptPreview: string | null;
  recentToolNames: string[];
  lastToolName: string | null;
}

interface WorkflowPhaseSummary {
  title: string;
  detail: string | null;
  doneCount: number;
  totalCount: number;
  isCurrent: boolean;
}

export interface WorkflowRunState {
  workflowTaskId: string;
  name: string;
  description: string | null;
  startedAt: string;
  status: "running" | "paused" | "completed" | "failed" | "stopped";
  settled: boolean;

  pausedByUser: boolean;

  runId: string | null;
  scriptPath: string | null;

  phases: WorkflowPhaseSummary[] | null;
  runningCount: number;
  agents: WorkflowAgentRow[];

  taskIds: string[];
}

export interface WorkflowSubagentThreadRef {
  threadId: string;
  model?: string | undefined;
  effort?: string | undefined;
}

export function buildWorkflowResumePrompt(scriptPath: string, runId: string): string {
  return `Resume the workflow by invoking the Workflow tool with {"scriptPath": ${JSON.stringify(scriptPath)}, "resumeFromRunId": ${JSON.stringify(runId)}}. Do not modify the script.`;
}

interface WorkflowProgressEntry {
  phase: string | null;
  label: string;
  at: string;
}

interface WorkflowFinalAgent {
  label: string;
  phaseIndex: number | null;
  phaseTitle: string | null;
  model: string | null;
  effort: string | null;
  state: string | null;
  tokens: number | null;
  toolCalls: number | null;
  durationMs: number | null;
  lastToolName: string | null;
  promptPreview: string | null;
}

interface WorkflowLiveAgent {
  agentId: string;
  label: string | null;
  model: string | null;
  effort: string | null;
  state: "running" | "completed" | null;
  tokens: number | null;
  toolCalls: number | null;
  recentToolNames: string[];
  promptPreview: string | null;
  startedAt: string | null;
  lastActivityAt: string | null;
}

interface WorkflowAgentPlanEntry {
  phase: string | null;
  model: string | null;
  effort: string | null;
}

interface TaskSnapshot {
  taskId: string;
  startedAt: string;
  description: string;
  taskType: string | null;
  subagentType: string | null;
  workflowName: string | null;
  workflowTaskId: string | null;
  toolUseId: string | null;
  status: "running" | "paused" | "completed" | "failed" | "stopped";
  totalTokens: number | null;
  durationMs: number | null;
  phases: Array<{ title: string; detail: string | null }> | null;
  agentPhases: Record<string, string> | null;
  agentPlans: Record<string, WorkflowAgentPlanEntry> | null;
  runId: string | null;
  scriptPath: string | null;
  progress: WorkflowProgressEntry[];
  liveAgents: WorkflowLiveAgent[] | null;
  finalAgents: WorkflowFinalAgent[] | null;
}

function readUsage(payload: Record<string, unknown>): {
  totalTokens: number | null;
  durationMs: number | null;
} {
  const usage = asObjectRecord(payload.usage);
  return {
    totalTokens: usage && typeof usage.total_tokens === "number" ? usage.total_tokens : null,
    durationMs: usage && typeof usage.duration_ms === "number" ? usage.duration_ms : null,
  };
}

function readPhases(value: unknown): TaskSnapshot["phases"] {
  if (!Array.isArray(value)) {
    return null;
  }
  const phases = value.flatMap((entry) => {
    const record = asObjectRecord(entry);
    const title = record ? (asNonEmptyString(record.title) ?? null) : null;
    return record && title ? [{ title, detail: asNonEmptyString(record.detail) ?? null }] : [];
  });
  return phases.length > 0 ? phases : null;
}

function readAgentPhases(value: unknown): Record<string, string> | null {
  const record = asObjectRecord(value);
  if (!record) {
    return null;
  }
  const pairs = Object.entries(record).filter(
    (entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].length > 0,
  );
  return pairs.length > 0 ? Object.fromEntries(pairs) : null;
}

function readAgentPlans(value: unknown): Record<string, WorkflowAgentPlanEntry> | null {
  const record = asObjectRecord(value);
  if (!record) {
    return null;
  }
  const entries = Object.entries(record).flatMap(
    ([label, plan]): Array<[string, WorkflowAgentPlanEntry]> => {
      const planRecord = asObjectRecord(plan);
      if (!planRecord) {
        return [];
      }
      const parsed: WorkflowAgentPlanEntry = {
        phase: asNonEmptyString(planRecord.phase) ?? null,
        model: asNonEmptyString(planRecord.model) ?? null,
        effort: asNonEmptyString(planRecord.effort) ?? null,
      };
      return parsed.phase || parsed.model || parsed.effort ? [[label, parsed]] : [];
    },
  );
  return entries.length > 0 ? Object.fromEntries(entries) : null;
}

function readFinalAgents(value: unknown): WorkflowFinalAgent[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const agents = value.flatMap((entry) => {
    const record = asObjectRecord(entry);
    const label = record ? (asNonEmptyString(record.label) ?? null) : null;
    if (!record || !label) {
      return [];
    }
    return [
      {
        label,
        phaseIndex: typeof record.phaseIndex === "number" ? record.phaseIndex : null,
        phaseTitle: asNonEmptyString(record.phaseTitle) ?? null,
        model: asNonEmptyString(record.model) ?? null,
        effort: asNonEmptyString(record.effort) ?? null,
        state: asNonEmptyString(record.state) ?? null,
        tokens: asFiniteNumber(record.tokens) ?? null,
        toolCalls: asFiniteNumber(record.toolCalls) ?? null,
        durationMs: asFiniteNumber(record.durationMs) ?? null,
        lastToolName: asNonEmptyString(record.lastToolName) ?? null,
        promptPreview: asNonEmptyString(record.promptPreview) ?? null,
      },
    ];
  });
  return agents.length > 0 ? agents : null;
}

function readLiveAgents(value: unknown): WorkflowLiveAgent[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const agents = value.flatMap((entry): Array<WorkflowLiveAgent> => {
    const record = asObjectRecord(entry);
    const agentId = record ? (asNonEmptyString(record.agentId) ?? null) : null;
    if (!record || !agentId) {
      return [];
    }
    const state = asNonEmptyString(record.state) ?? null;
    return [
      {
        agentId,
        label: asNonEmptyString(record.label) ?? null,
        model: asNonEmptyString(record.model) ?? null,
        effort: asNonEmptyString(record.effort) ?? null,
        state: state === "running" || state === "completed" ? state : null,
        tokens: asFiniteNumber(record.tokens) ?? null,
        toolCalls: asFiniteNumber(record.toolCalls) ?? null,
        recentToolNames: Array.isArray(record.recentToolNames)
          ? record.recentToolNames.filter(
              (name): name is string => typeof name === "string" && name.length > 0,
            )
          : [],
        promptPreview: asNonEmptyString(record.promptPreview) ?? null,
        startedAt: asNonEmptyString(record.startedAt) ?? null,
        lastActivityAt: asNonEmptyString(record.lastActivityAt) ?? null,
      },
    ];
  });
  return agents.length > 0 ? agents : null;
}

function parseProgressDescription(description: string): Omit<WorkflowProgressEntry, "at"> | null {
  const separator = description.indexOf(": ");
  const phase = separator > 0 ? description.slice(0, separator).trim() : null;
  const label = (separator > 0 ? description.slice(separator + 2) : description).trim();
  return label.length > 0 ? { phase: phase && phase.length > 0 ? phase : null, label } : null;
}

function completionStatus(status: string | null): TaskSnapshot["status"] {
  return status === "failed" ? "failed" : status === "stopped" ? "stopped" : "completed";
}

function collectTaskSnapshots(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
): Map<string, TaskSnapshot> {
  const snapshots = new Map<string, TaskSnapshot>();
  for (const activity of orderedActivities(activities)) {
    if (
      activity.kind !== "task.started" &&
      activity.kind !== "task.progress" &&
      activity.kind !== "task.updated" &&
      activity.kind !== "task.completed"
    ) {
      continue;
    }
    const payload = asObjectRecord(activity.payload);
    const taskId = payload ? (asNonEmptyString(payload.taskId) ?? null) : null;
    if (!payload || !taskId) {
      continue;
    }

    if (activity.kind === "task.started") {
      snapshots.set(taskId, {
        taskId,
        startedAt: activity.createdAt,
        description: asNonEmptyString(payload.detail) ?? "Task",
        taskType: asNonEmptyString(payload.taskType) ?? null,
        subagentType: asNonEmptyString(payload.subagentType) ?? null,
        workflowName: asNonEmptyString(payload.workflowName) ?? null,
        workflowTaskId: asNonEmptyString(payload.workflowTaskId) ?? null,
        toolUseId: asNonEmptyString(payload.toolUseId) ?? null,
        status: "running",
        totalTokens: null,
        durationMs: null,
        phases: readPhases(payload.workflowPhases),
        agentPhases: readAgentPhases(payload.workflowAgentPhases),
        agentPlans: readAgentPlans(payload.workflowAgentPlans),
        runId: null,
        scriptPath: null,
        progress: [],
        liveAgents: null,
        finalAgents: null,
      });
      continue;
    }

    const snapshot = snapshots.get(taskId);
    if (!snapshot) {
      continue;
    }

    if (activity.kind === "task.progress") {
      const usage = readUsage(payload);
      snapshot.totalTokens = usage.totalTokens ?? snapshot.totalTokens;
      snapshot.durationMs = usage.durationMs ?? snapshot.durationMs;

      const liveAgents = readLiveAgents(payload.workflowAgents);
      if (liveAgents) {
        snapshot.liveAgents = liveAgents;
        continue;
      }
      if (snapshot.taskType === "local_workflow") {
        const description =
          asNonEmptyString(payload.description) ?? asNonEmptyString(payload.detail) ?? null;
        const entry = description ? parseProgressDescription(description) : null;
        if (entry) {
          snapshot.progress.push({ ...entry, at: activity.createdAt });
        }
      }
      continue;
    }

    if (activity.kind === "task.updated") {
      snapshot.runId = asNonEmptyString(payload.workflowRunId) ?? snapshot.runId;
      snapshot.scriptPath = asNonEmptyString(payload.workflowScriptPath) ?? snapshot.scriptPath;
      const status = asNonEmptyString(payload.status) ?? null;
      if (status === "paused") {
        snapshot.status = "paused";
      } else if (status === "running" || status === "pending") {
        snapshot.status = "running";
      } else if (status === "killed") {
        snapshot.status = "stopped";
      } else if (status === "completed" || status === "failed") {
        snapshot.status = status;
      }
      continue;
    }

    snapshot.status = completionStatus(asNonEmptyString(payload.status) ?? null);
    snapshot.finalAgents = readFinalAgents(payload.workflowAgents) ?? snapshot.finalAgents;
    const usage = readUsage(payload);
    snapshot.totalTokens = usage.totalTokens ?? snapshot.totalTokens;
    snapshot.durationMs = usage.durationMs ?? snapshot.durationMs;
  }
  return snapshots;
}

function agentStatusPresentation(status: TaskSnapshot["status"]): {
  statusKind: SubagentStatusKind;
  statusLabel: string;
} {
  switch (status) {
    case "running":
      return { statusKind: "running", statusLabel: "Running" };
    case "paused":
      return { statusKind: "idle", statusLabel: "Paused" };
    case "completed":
      return { statusKind: "completed", statusLabel: "Completed" };
    case "failed":
      return { statusKind: "failed", statusLabel: "Failed" };
    case "stopped":
      return { statusKind: "stopped", statusLabel: "Stopped" };
  }
}

function isSettledStatusKind(statusKind: SubagentStatusKind): boolean {
  return statusKind === "completed" || statusKind === "failed" || statusKind === "stopped";
}

function finalAgentStatus(
  state: string | null,
  workflowStatus: TaskSnapshot["status"],
): TaskSnapshot["status"] {
  switch (state) {
    case "completed":
      return "completed";
    case "failed":
    case "error":
      return "failed";
    case "killed":
    case "stopped":
      return "stopped";
    default:
      return workflowStatus === "running" || workflowStatus === "paused"
        ? "completed"
        : workflowStatus;
  }
}

function liveDurationMs(agent: WorkflowLiveAgent | null | undefined): number | null {
  if (!agent || agent.state !== "completed" || !agent.startedAt || !agent.lastActivityAt) {
    return null;
  }
  const startedMs = Date.parse(agent.startedAt);
  const lastMs = Date.parse(agent.lastActivityAt);
  return Number.isNaN(startedMs) || Number.isNaN(lastMs) ? null : Math.max(0, lastMs - startedMs);
}

export function workflowElapsedMs(
  row: Pick<WorkflowAgentRow, "durationMs" | "statusKind" | "startedAt">,
  nowMs: number,
): number | null {
  if (row.statusKind === "running" || row.statusKind === "idle") {
    const startedAtMs = Date.parse(row.startedAt);
    return Number.isNaN(startedAtMs) ? row.durationMs : Math.max(0, nowMs - startedAtMs);
  }
  return row.durationMs;
}

const OTHER_PHASE_TITLE = "Other";

export function deriveWorkflowRunState(input: {
  activities: ReadonlyArray<OrchestrationThreadActivity>;
  subagentThreadsByToolUseId?: ReadonlyMap<string, WorkflowSubagentThreadRef>;

  pausedByUserTaskIds?: ReadonlySet<string>;
  dismissedTaskIds?: ReadonlySet<string>;
}): WorkflowRunState | null {
  const snapshots = collectTaskSnapshots(input.activities);

  const workflow = [...snapshots.values()].findLast(
    (snapshot) => snapshot.taskType === "local_workflow",
  );
  if (!workflow) {
    return null;
  }
  const settled = workflow.status !== "running";
  const pausedByUser =
    workflow.status === "stopped" && (input.pausedByUserTaskIds?.has(workflow.taskId) ?? false);
  const canResume = workflow.runId !== null && workflow.scriptPath !== null;
  if (settled && (input.dismissedTaskIds?.has(workflow.taskId) || (!pausedByUser && !canResume))) {
    return null;
  }

  const planForLabel = (label: string): WorkflowAgentPlanEntry | null => {
    const plans = workflow.agentPlans;
    if (!plans) {
      return null;
    }
    const exact = plans[label];
    if (exact) {
      return exact;
    }
    const lower = label.toLowerCase();
    const match = Object.entries(plans).find(([candidate]) => candidate.toLowerCase() === lower);
    return match ? match[1] : null;
  };

  const phaseForLabel = (label: string): string | null => {
    const planned = planForLabel(label)?.phase;
    if (planned) {
      return planned;
    }
    if (!workflow.agentPhases) {
      return null;
    }
    const exact = workflow.agentPhases[label];
    if (exact) {
      return exact;
    }
    const lower = label.toLowerCase();
    const match = Object.entries(workflow.agentPhases).find(
      ([candidate]) => candidate.toLowerCase() === lower,
    );
    return match ? match[1] : null;
  };

  const canonicalPhase = (phase: string | null): string | null => {
    if (phase === null) {
      return null;
    }
    const lower = phase.toLowerCase();
    return workflow.phases?.find((entry) => entry.title.toLowerCase() === lower)?.title ?? phase;
  };

  const memberSnapshots = [...snapshots.values()].filter(
    (snapshot) =>
      snapshot.workflowTaskId === workflow.taskId &&
      snapshot.taskType !== "local_bash" &&
      !(snapshot.toolUseId !== null && snapshot.subagentType !== null),
  );
  let lastMatchedPhase: string | null = null;
  const memberRows = memberSnapshots.map((snapshot): WorkflowAgentRow => {
    const matched = canonicalPhase(phaseForLabel(snapshot.description));
    if (matched !== null) {
      lastMatchedPhase = matched;
    }
    const threadRef = snapshot.toolUseId
      ? input.subagentThreadsByToolUseId?.get(snapshot.toolUseId)
      : undefined;
    const { statusKind, statusLabel } = agentStatusPresentation(snapshot.status);
    const plan = planForLabel(snapshot.description);
    const model = threadRef?.model ?? plan?.model ?? null;
    return {
      taskId: snapshot.taskId,
      description: snapshot.description,
      subagentType: snapshot.subagentType,
      phase: matched ?? lastMatchedPhase,
      statusKind,
      statusLabel,
      totalTokens: snapshot.totalTokens,
      toolCalls: null,
      durationMs: snapshot.durationMs,
      startedAt: snapshot.startedAt,
      threadId: threadRef ? ThreadId.makeUnsafe(threadRef.threadId) : null,
      model,
      modelLabel: formatSubagentModelLabel(model),
      effortLabel: formatEffortLabel(threadRef?.effort ?? plan?.effort ?? "") || null,
      promptPreview: null,
      recentToolNames: [],
      lastToolName: null,
    };
  });

  const progressByLabel = new Map<string, { phase: string | null; firstAt: string }>();
  for (const entry of workflow.progress) {
    const existing = progressByLabel.get(entry.label);
    progressByLabel.set(entry.label, {
      phase: canonicalPhase(entry.phase) ?? existing?.phase ?? null,
      firstAt: existing?.firstAt ?? entry.at,
    });
  }
  const latestEntry = workflow.progress.at(-1);
  const latestPhase = latestEntry ? canonicalPhase(latestEntry.phase) : null;
  const finalAgentByLabel = new Map(
    (workflow.finalAgents ?? []).map((agent) => [agent.label.toLowerCase(), agent]),
  );
  const finalAgentPhase = (agent: WorkflowFinalAgent): string | null =>
    canonicalPhase(agent.phaseTitle) ??
    (agent.phaseIndex !== null ? (workflow.phases?.[agent.phaseIndex - 1]?.title ?? null) : null);

  const liveAgents = workflow.liveAgents ?? [];
  const liveByLabel = new Map(
    liveAgents.flatMap(
      (agent): Array<[string, WorkflowLiveAgent]> =>
        agent.label ? [[agent.label.toLowerCase(), agent]] : [],
    ),
  );
  const claimedLiveAgents = new Set<WorkflowLiveAgent>();
  const orderedLabels = [...progressByLabel.keys()];
  const liveForLabel = (label: string): WorkflowLiveAgent | undefined => {
    const byLabel = liveByLabel.get(label.toLowerCase());
    if (byLabel) {
      claimedLiveAgents.add(byLabel);
      return byLabel;
    }
    const index = orderedLabels.indexOf(label);
    const byOrder = index >= 0 ? liveAgents[index] : undefined;
    if (byOrder && !byOrder.label && !claimedLiveAgents.has(byOrder)) {
      claimedLiveAgents.add(byOrder);
      return byOrder;
    }
    return undefined;
  };
  const memberDescriptions = new Set(memberRows.map((row) => row.description.toLowerCase()));
  const progressRows = [...progressByLabel.entries()]
    .filter(([label]) => !memberDescriptions.has(label.toLowerCase()))
    .map(([label, entry]): WorkflowAgentRow => {
      const finalAgent = finalAgentByLabel.get(label.toLowerCase());
      const live = liveForLabel(label);
      const plan = planForLabel(label);
      const phase =
        entry.phase ??
        (finalAgent ? finalAgentPhase(finalAgent) : null) ??
        canonicalPhase(phaseForLabel(label));
      const status: TaskSnapshot["status"] = settled
        ? finalAgentStatus(finalAgent?.state ?? null, workflow.status)
        : live?.state === "completed"
          ? "completed"
          : live?.state === "running"
            ? "running"
            : (phase !== null && phase === latestPhase) || label === latestEntry?.label
              ? "running"
              : "completed";
      const { statusKind, statusLabel } = agentStatusPresentation(status);
      const model = live?.model ?? finalAgent?.model ?? plan?.model ?? null;
      const effort = live?.effort ?? finalAgent?.effort ?? plan?.effort ?? null;
      return {
        taskId: `${workflow.taskId}:agent:${label}`,
        description: label,
        subagentType: null,
        phase,
        statusKind,
        statusLabel,
        totalTokens: finalAgent?.tokens ?? live?.tokens ?? null,
        toolCalls: finalAgent?.toolCalls ?? live?.toolCalls ?? null,
        durationMs: finalAgent?.durationMs ?? liveDurationMs(live) ?? null,
        startedAt: live?.startedAt ?? entry.firstAt,
        threadId: null,
        model,
        modelLabel: formatSubagentModelLabel(model),
        effortLabel: effort ? formatEffortLabel(effort) : null,
        promptPreview: live?.promptPreview ?? finalAgent?.promptPreview ?? null,
        recentToolNames: live?.recentToolNames ?? [],
        lastToolName: finalAgent?.lastToolName ?? live?.recentToolNames.at(-1) ?? null,
      };
    });

  const seenLabels = new Set(
    [...progressRows, ...memberRows].map((row) => row.description.toLowerCase()),
  );
  const backfilledRows = settled
    ? (workflow.finalAgents ?? [])
        .filter((agent) => !seenLabels.has(agent.label.toLowerCase()))
        .map((agent): WorkflowAgentRow => {
          const { statusKind, statusLabel } = agentStatusPresentation(
            finalAgentStatus(agent.state, workflow.status),
          );
          const plan = planForLabel(agent.label);
          const model = agent.model ?? plan?.model ?? null;
          return {
            taskId: `${workflow.taskId}:agent:${agent.label}`,
            description: agent.label,
            subagentType: null,
            phase: finalAgentPhase(agent) ?? canonicalPhase(phaseForLabel(agent.label)),
            statusKind,
            statusLabel,
            totalTokens: agent.tokens,
            toolCalls: agent.toolCalls,
            durationMs: agent.durationMs,
            startedAt: workflow.startedAt,
            threadId: null,
            model,
            modelLabel: formatSubagentModelLabel(model),
            effortLabel: formatEffortLabel(agent.effort ?? plan?.effort ?? "") || null,
            promptPreview: agent.promptPreview,
            recentToolNames: [],
            lastToolName: agent.lastToolName,
          };
        })
    : [];

  const liveOnlyRows = settled
    ? []
    : liveAgents
        .filter(
          (agent) =>
            !claimedLiveAgents.has(agent) &&
            (agent.label === null || !seenLabels.has(agent.label.toLowerCase())),
        )
        .map((agent, index): WorkflowAgentRow => {
          const label = agent.label ?? `Agent ${orderedLabels.length + index + 1}`;
          const plan = agent.label ? planForLabel(agent.label) : null;
          const { statusKind, statusLabel } = agentStatusPresentation(
            agent.state === "completed" ? "completed" : "running",
          );
          const model = agent.model ?? plan?.model ?? null;
          return {
            taskId: `${workflow.taskId}:agent-id:${agent.agentId}`,
            description: label,
            subagentType: null,
            phase: agent.label ? canonicalPhase(phaseForLabel(agent.label)) : null,
            statusKind,
            statusLabel,
            totalTokens: agent.tokens,
            toolCalls: agent.toolCalls,
            durationMs: liveDurationMs(agent),
            startedAt: agent.startedAt ?? workflow.startedAt,
            threadId: null,
            model,
            modelLabel: formatSubagentModelLabel(model),
            effortLabel: formatEffortLabel(agent.effort ?? plan?.effort ?? "") || null,
            promptPreview: agent.promptPreview,
            recentToolNames: agent.recentToolNames,
            lastToolName: agent.recentToolNames.at(-1) ?? null,
          };
        });

  const agents = [...memberRows, ...progressRows, ...backfilledRows, ...liveOnlyRows];

  if (workflow.phases !== null || agents.some((row) => row.phase !== null)) {
    for (const row of agents) {
      row.phase ??= OTHER_PHASE_TITLE;
    }
  }

  const orderedPhases: Array<{ title: string; detail: string | null }> = [
    ...(workflow.phases ?? []),
  ];
  for (const row of agents) {
    if (
      row.phase !== null &&
      row.phase !== OTHER_PHASE_TITLE &&
      !orderedPhases.some((phase) => phase.title === row.phase)
    ) {
      orderedPhases.push({ title: row.phase, detail: null });
    }
  }
  if (agents.some((row) => row.phase === OTHER_PHASE_TITLE)) {
    orderedPhases.push({ title: OTHER_PHASE_TITLE, detail: null });
  }

  let phases: WorkflowPhaseSummary[] | null = null;
  if (orderedPhases.length > 0) {
    phases = orderedPhases.map((phase) => {
      const rows = agents.filter((row) => row.phase === phase.title);
      return {
        title: phase.title,
        detail: phase.detail,
        doneCount: rows.filter((row) => isSettledStatusKind(row.statusKind)).length,
        totalCount: rows.length,
        isCurrent: false,
      };
    });
    const current =
      phases.find((phase) => phase.doneCount < phase.totalCount) ??
      phases.findLast((phase) => phase.totalCount > 0) ??
      (settled ? undefined : phases[0]);
    if (current) {
      current.isCurrent = true;
    }
  }

  return {
    workflowTaskId: workflow.taskId,
    name: workflow.workflowName ?? workflow.description,
    description: workflow.workflowName ? workflow.description : null,
    startedAt: workflow.startedAt,
    status: workflow.status,
    settled,
    pausedByUser,
    runId: workflow.runId,
    scriptPath: workflow.scriptPath,
    phases,
    runningCount: agents.filter((agent) => agent.statusKind === "running").length,
    agents,
    taskIds: [workflow.taskId, ...memberRows.map((agent) => agent.taskId)],
  };
}
