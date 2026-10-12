import type { OrchestrationThreadActivity } from "@glade/contracts/orchestration/threadEntities";
import { pluralize } from "@glade/shared/text/text";
import { asRecord } from "@glade/shared/transport/payloadValues";
import { basenameOfPath } from "~/file-icons";
import { normalizeSubagentStatusKind, type SubagentStatusKind } from "~/lib/subagentPresentation";
import { deriveFriendlyCommandTarget } from "~/lib/toolCallLabel.commands";
import { normalizeCompactToolLabel } from "~/lib/toolCallLabel.presentations";
import type {
  WorkLogEntry,
  WorkLogSubagent,
  WorkLogSubagentRunMember,
  WorkLogSubagentUsage,
} from "~/workLog.types";

// One run of a subagent task; a subagent resumed later reports a second run under the same id.
interface SubagentTaskRun {
  startedAt: string;
  usage?: WorkLogSubagentUsage;
  settledAt?: string;
  // Providers may move a subagent to the background after launch, or launch it there by default.
  backgrounded?: boolean;
}

export interface SubagentTaskReports {
  runsByProviderThreadId: ReadonlyMap<string, ReadonlyArray<SubagentTaskRun>>;
  // Progress pings already shown on their subagent's row; they are not the parent's reasoning.
  progressActivityIds: ReadonlySet<string>;
}

const STATE_ONLY_TOOLS = new Set(["wait", "waitagent", "sendinput", "closeagent"]);

function readUsage(value: unknown): WorkLogSubagentUsage | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  const number = (key: string) => {
    const raw = record[key];
    return typeof raw === "number" && Number.isFinite(raw) ? raw : undefined;
  };
  const usage: WorkLogSubagentUsage = {};
  const totalTokens = number("total_tokens") ?? number("totalTokens");
  const toolUses = number("tool_uses") ?? number("toolUses");
  const durationMs = number("duration_ms") ?? number("durationMs");
  if (totalTokens !== undefined) usage.totalTokens = totalTokens;
  if (toolUses !== undefined) usage.toolUses = toolUses;
  if (durationMs !== undefined) usage.durationMs = durationMs;
  return Object.keys(usage).length > 0 ? usage : undefined;
}

const TERMINAL_TASK_STATUSES = new Set(["completed", "failed", "killed", "stopped"]);

// Providers that report subagents as tasks key them by task id; `task.started` names the tool call
// that launched each one, which is the subagent's provider thread id.
export function deriveSubagentTaskReports(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
): SubagentTaskReports {
  const providerThreadIdByTaskId = new Map<string, string>();
  const runsByProviderThreadId = new Map<string, SubagentTaskRun[]>();
  const progressActivityIds = new Set<string>();
  for (const activity of activities) {
    if (!activity.kind.startsWith("task.")) continue;
    const payload = asRecord(activity.payload);
    const taskId = typeof payload?.taskId === "string" ? payload.taskId : null;
    if (!taskId) continue;
    if (activity.kind === "task.started") {
      if (typeof payload?.toolUseId === "string" && typeof payload.subagentType === "string") {
        providerThreadIdByTaskId.set(taskId, payload.toolUseId);
        const runs = runsByProviderThreadId.get(payload.toolUseId) ?? [];
        runs.push({ startedAt: activity.createdAt });
        runsByProviderThreadId.set(payload.toolUseId, runs);
      }
      continue;
    }
    const providerThreadId = providerThreadIdByTaskId.get(taskId);
    const run = providerThreadId ? runsByProviderThreadId.get(providerThreadId)?.at(-1) : undefined;
    if (!run) continue;
    const usage = readUsage(payload?.usage);
    if (usage) run.usage = usage;
    if (typeof payload?.isBackgrounded === "boolean") run.backgrounded = payload.isBackgrounded;
    if (activity.kind === "task.progress") {
      progressActivityIds.add(activity.id);
    } else if (
      activity.kind === "task.completed" ||
      TERMINAL_TASK_STATUSES.has(String(payload?.status))
    ) {
      run.settledAt ??= activity.createdAt;
    }
  }
  return { runsByProviderThreadId, progressActivityIds };
}

// The run a transcript invocation describes: the first to start once it was launched.
function taskRunFor(
  reports: SubagentTaskReports,
  member: Pick<WorkLogSubagentRunMember, "subagent" | "launchedAt">,
): SubagentTaskRun | undefined {
  const runs = reports.runsByProviderThreadId.get(subagentKey(member.subagent)) ?? [];
  return runs.find((run) => run.startedAt >= member.launchedAt) ?? runs.at(-1);
}

function subagentKey(subagent: WorkLogSubagent): string {
  return subagent.providerThreadId ?? subagent.threadId;
}

function isLaunchEntry(entry: WorkLogEntry): boolean {
  const tool = entry.subagentAction?.tool.toLowerCase().replace(/[^a-z]/g, "") ?? "";
  return !STATE_ONLY_TOOLS.has(tool);
}

function isSettledSubagent(subagent: WorkLogSubagent): boolean {
  const kind = subagentStatusKind(subagent);
  return kind === "completed" || kind === "failed" || kind === "stopped";
}

// Later calls about the same subagent (wait, close, a fresher status) refine its snapshot without
// erasing what the launch knew, such as the prompt and model.
function mergeSnapshot(previous: WorkLogSubagent, next: WorkLogSubagent): WorkLogSubagent {
  const merged: WorkLogSubagent = { ...previous };
  for (const [key, value] of Object.entries(next)) {
    if (value !== undefined) Object.assign(merged, { [key]: value });
  }
  return merged;
}

type MemberDraft = WorkLogSubagentRunMember & { lastSeenAt: string };

interface RunDraft {
  anchor: WorkLogEntry;
  members: Map<string, MemberDraft>;
}

function frozenStatus(member: MemberDraft): string {
  const kind = normalizeSubagentStatusKind(member.subagent.rawStatus);
  return kind === "failed" ? "Failed" : kind === "stopped" ? "Stopped" : "Completed";
}

// Subagents launched back to back collapse into one entry at the first launch. Status-only calls
// update the run that owns the subagent instead of adding rows.
export function foldSubagentRunEntries(
  entries: ReadonlyArray<WorkLogEntry>,
  reports: SubagentTaskReports,
): WorkLogEntry[] {
  const output: Array<WorkLogEntry | RunDraft> = [];
  const runByKey = new Map<string, RunDraft>();
  const turnsWithRuns = new Set<string | null | undefined>();
  let openRun: RunDraft | null = null;

  for (const entry of entries) {
    if (reports.progressActivityIds.has(entry.id)) continue;
    const subagents = entry.subagents ?? [];
    const isCollab = entry.itemType === "collab_agent_tool_call";
    // Codex waits name no receivers; the run card of that turn already shows who is still working.
    if (
      isCollab &&
      subagents.length === 0 &&
      !isLaunchEntry(entry) &&
      turnsWithRuns.has(entry.turnId)
    ) {
      continue;
    }
    if (!isCollab || subagents.length === 0) {
      output.push(entry);
      openRun = null;
      continue;
    }
    if (openRun && openRun.anchor.turnId !== entry.turnId) openRun = null;
    const launch = isLaunchEntry(entry);
    for (const subagent of subagents) {
      const key = subagentKey(subagent);
      const known = runByKey.get(key);
      const member = known?.members.get(key);
      // A subagent picked up again by a later turn, or relaunched after it finished, is a new
      // invocation. The child thread's state now describes the new one, so the earlier row is frozen
      // at what it last reported.
      const resumed =
        member !== undefined &&
        (known?.anchor.turnId !== entry.turnId || (launch && isSettledSubagent(member.subagent)));
      if (member && !resumed) {
        member.subagent = mergeSnapshot(member.subagent, subagent);
        member.lastSeenAt = entry.createdAt;
        continue;
      }
      if (member) {
        member.settledAt ??= taskRunFor(reports, member)?.settledAt ?? member.lastSeenAt;
        member.subagent = {
          ...member.subagent,
          isActive: false,
          statusLabel: frozenStatus(member),
        };
      }
      if (!openRun) {
        openRun = { anchor: entry, members: new Map() };
        output.push(openRun);
        turnsWithRuns.add(entry.turnId);
      }
      openRun.members.set(key, {
        subagent,
        launchedAt: entry.createdAt,
        lastSeenAt: entry.createdAt,
      });
      runByKey.set(key, openRun);
    }
  }

  return output.map((item) => ("anchor" in item ? toRunEntry(item, reports) : item));
}

function toRunEntry(run: RunDraft, reports: SubagentTaskReports): WorkLogEntry {
  const members = [...run.members.values()].map(({ lastSeenAt: _lastSeenAt, ...member }) => {
    const taskRun = taskRunFor(reports, member);
    const settledAt = member.settledAt ?? taskRun?.settledAt;
    return {
      ...member,
      ...(taskRun?.backgrounded ? { subagent: { ...member.subagent, background: true } } : {}),
      ...(settledAt ? { settledAt } : {}),
      ...(taskRun?.usage ? { usage: taskRun.usage } : {}),
    };
  });
  return {
    ...run.anchor,
    id: `subagent-run:${run.anchor.id}`,
    subagents: members.map((member) => member.subagent),
    subagentRun: { members },
  };
}

export function subagentStatusKind(subagent: WorkLogSubagent): SubagentStatusKind | null {
  if (subagent.isActive) return "running";
  return normalizeSubagentStatusKind(subagent.statusLabel ?? subagent.rawStatus);
}

// The settle time is exact; a provider's usage duration may come from the last progress ping
// before the subagent finished, so it is only a fallback.
export function memberEndMs(member: WorkLogSubagentRunMember): number | null {
  const launchedAt = Date.parse(member.launchedAt);
  const end = member.settledAt ?? member.subagent.lastCompletedAt;
  const endMs = end ? Date.parse(end) : Number.NaN;
  if (!Number.isNaN(endMs) && endMs >= launchedAt) return endMs;
  if (member.usage?.durationMs !== undefined && !member.subagent.isActive) {
    return launchedAt + member.usage.durationMs;
  }
  return null;
}

export function describeRunHeader(members: ReadonlyArray<WorkLogSubagentRunMember>): string {
  const counts = new Map<SubagentStatusKind, number>();
  for (const member of members) {
    const kind = subagentStatusKind(member.subagent);
    if (kind) counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }
  const parts = [`${members.length} ${pluralize(members.length, "subagent")}`];
  const running = (counts.get("running") ?? 0) + (counts.get("queued") ?? 0);
  if (running > 0) parts.push(`${running} running`);
  const done = counts.get("completed") ?? 0;
  if (done > 0 && done < members.length) parts.push(`${done} done`);
  const failed = counts.get("failed") ?? 0;
  if (failed > 0) parts.push(`${failed} failed`);
  const stopped = counts.get("stopped") ?? 0;
  if (stopped > 0) parts.push(`${stopped} stopped`);
  return parts.join(" · ");
}

function formatTokenCount(tokens: number): string {
  if (tokens < 1_000) return `${tokens} tokens`;
  const thousands = tokens / 1_000;
  return `${thousands < 10 ? thousands.toFixed(1).replace(/\.0$/, "") : Math.round(thousands)}k tokens`;
}

export function formatUsage(usage: WorkLogSubagentUsage | undefined): string | null {
  if (!usage) return null;
  const parts: string[] = [];
  if (usage.totalTokens !== undefined) parts.push(formatTokenCount(usage.totalTokens));
  if (usage.toolUses !== undefined) {
    parts.push(`${usage.toolUses} ${pluralize(usage.toolUses, "tool call")}`);
  }
  return parts.length > 0 ? parts.join(" · ") : null;
}

// The child's own latest tool call, read from its thread, so every provider gets the same live step.
export function describeLatestStep(entries: ReadonlyArray<WorkLogEntry>): string | null {
  const latest = entries.findLast((entry) => entry.tone === "tool" && !entry.subagentRun);
  if (!latest) return null;
  const heading = normalizeCompactToolLabel(latest.toolTitle ?? latest.label).trim();
  const command = latest.command ?? latest.rawCommand;
  const target = command
    ? deriveFriendlyCommandTarget(command)
    : (latest.preview ?? (latest.changedFiles?.[0] ? basenameOfPath(latest.changedFiles[0]) : ""));
  const text =
    target && !heading.toLowerCase().includes(target.toLowerCase())
      ? `${heading} ${target}`
      : heading;
  return text.trim() || null;
}

// A one-line preview of a reply: markdown markers dropped and lines joined, so a reply that opens
// with "Output:" still shows what followed it.
export function previewLine(text: string | undefined): string | null {
  const preview = text
    ?.split("\n")
    .map((line) =>
      line
        .replace(/^[#>*\-\s]+/, "")
        .replaceAll("`", "")
        .trim(),
    )
    .filter((line) => line.length > 0)
    .join(" ")
    .slice(0, 240);
  return preview || null;
}
