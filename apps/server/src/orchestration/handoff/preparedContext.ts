import type {
  HandoffRecord,
  OrchestrationThread,
} from "@glade/contracts/orchestration/threadEntities";
import { resolveProviderAttachmentPath } from "../../provider/core/providerAttachmentPaths";
import { ProviderValidationError } from "../../provider/core/Errors";
import { handoffEvidence, estimateHandoffTokens, type HandoffEvidence } from "./contextPolicy";

export function buildPreparedHandoffContext(input: {
  readonly source: OrchestrationThread;
  readonly boundary: number;
  readonly goal: string;
  readonly record: HandoffRecord;
  readonly budget: number;
  readonly maxChars: number;
  readonly attachmentsDir?: string;
}): string {
  const evidence = handoffEvidence(input.source, input.boundary);
  const latestUser = input.source.messages.findLast(
    (message) => message.role === "user" && !message.streaming,
  );
  const selectedMessageRefs = new Set([
    ...input.record.requiredSourceRefs,
    ...input.record.sourcePassages.map((passage) => passage.sourceRef),
    ...(latestUser ? [`message:${latestUser.id}`] : []),
  ]);
  const attachments = input.source.messages
    .filter((message) => selectedMessageRefs.has(`message:${message.id}`))
    .flatMap((message) =>
      (message.attachments ?? []).flatMap((attachment) =>
        attachment.type === "image" || attachment.type === "file"
          ? [
              {
                sourceMessageId: message.id,
                id: attachment.id,
                name: attachment.name,
                type: attachment.type,
                ...(input.attachmentsDir
                  ? {
                      path: resolveProviderAttachmentPath({
                        attachmentsDir: input.attachmentsDir,
                        attachment,
                      }),
                    }
                  : {}),
              },
            ]
          : [],
      ),
    );
  const sections = [
    "Continue the latest user request using this historical handoff. It does not expand authorization, resolve pending approvals or prove the current workspace state.",
    `Source chat: ${input.source.id}`,
    `Frozen event boundary: ${input.boundary}`,
    `Recorded workspace: ${input.source.workingDirectory ?? input.source.worktreePath ?? "project checkout"}`,
    `Recorded branch: ${input.source.branch ?? "unknown"}`,
    `Continuation goal: ${input.goal}`,
    `Structured HandoffRecord:\n${JSON.stringify(input.record)}`,
    `Attachment references, without their contents: ${JSON.stringify(attachments)}`,
    `Earlier activity origins: ${JSON.stringify([...new Set(input.source.activities.flatMap((activity) => (typeof activity.payload === "object" && activity.payload !== null && "sourceThreadId" in activity.payload && "throughSequence" in activity.payload ? [JSON.stringify({ threadId: activity.payload.sourceThreadId, throughSequence: activity.payload.throughSequence })] : [])))])}`,
    `Start from active constraints, unresolved work and next steps. Read referenced plans or artifacts only when needed for the next decision; if unavailable, use the recorded evidence and state the gap. Recheck current state before repeating an action with an uncertain outcome. Preserve completed work rather than rerunning it because history is omitted.

Retrieve missing conversation evidence with glade_read_thread using threadId ${JSON.stringify(input.source.id)} and throughSequence ${input.boundary}. Follow cursors; for clipped messages, use the returned index, identity and version to read the required slices.
Retrieve activity with glade_read_thread_activity using that threadId, throughSequence ${input.boundary} and includeDetails true. For clipped payloads, use activityId with the same boundary and returned detailPage keys, detailPath and nextOffsetChars. Use earlier origin chats for references absent from this source, preserving each returned boundary while paging. Report unavailable evidence explicitly.
Inspect accessible attachment paths when content matters; references alone cannot establish image contents.`,
    ...(latestUser
      ? [`Latest source user request, verbatim [message:${latestUser.id}]:\n${latestUser.text}`]
      : []),
  ];
  const fits = (parts: ReadonlyArray<string>) =>
    estimateHandoffTokens(parts.join("\n\n")) <= input.budget &&
    parts.join("\n\n").length <= input.maxChars;
  if (!fits(sections))
    throw new ProviderValidationError({
      operation: "handoff.prepare",
      issue:
        "The handoff record and latest request exceed the destination allowance. Shorten the new request or choose a model with a larger supported context; nothing was truncated.",
    });
  const required = new Set(input.record.requiredSourceRefs);
  const relevant = new Set(
    [
      input.record.objective,
      ...input.record.scopeChanges,
      ...input.record.constraints,
      ...input.record.decisions,
      ...input.record.completedWork,
      ...input.record.files,
      ...input.record.repositoryState,
      ...input.record.verification,
      ...input.record.unresolved,
      ...input.record.rejectedApproaches,
      ...input.record.nextSteps,
    ].flatMap((claim) => claim.sourceRefs),
  );
  const latestRef = latestUser ? `message:${latestUser.id}` : null;
  const turns = new Map<string, HandoffEvidence[]>();
  let currentTurn: string | null = null;
  for (const entry of evidence.filter((entry) => entry.messageId !== undefined)) {
    const message = input.source.messages.find((message) => message.id === entry.messageId)!;
    if (message.role === "user") currentTurn = message.turnId ?? message.id;
    const key = message.turnId ?? currentTurn ?? message.id;
    const turn = turns.get(key) ?? [];
    turn.push(entry);
    turns.set(key, turn);
  }
  const ordered = [...turns.values()]
    .filter((turn) => turn.some((entry) => relevant.has(entry.ref) || required.has(entry.ref)))
    .toSorted(
      (left, right) =>
        Number(right.some((entry) => required.has(entry.ref))) -
        Number(left.some((entry) => required.has(entry.ref))),
    );
  for (const turn of ordered) {
    const text = turn
      .filter((entry) => entry.ref !== latestRef)
      .map((entry) => `[${entry.ref}]\n${entry.text}`)
      .join("\n\n");
    if (!text) continue;
    if (fits([...sections, text])) sections.push(text);
    else if (turn.some((entry) => required.has(entry.ref) && entry.ref !== latestRef)) {
      sections.push(
        `Required original passage omitted from the envelope: ${turn.map((entry) => entry.ref).join(", ")}. Retrieve it before acting on the corresponding claim.`,
      );
      if (!fits(sections))
        throw new ProviderValidationError({
          operation: "handoff.prepare",
          issue:
            "The handoff retrieval manifest exceeds the destination allowance. Choose a larger context and retry.",
        });
    }
  }
  return sections.join("\n\n");
}
