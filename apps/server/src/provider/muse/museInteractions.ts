import { randomUUID } from "node:crypto";

import { RuntimeRequestId } from "@glade/contracts/core/baseSchemas";
import type { CanonicalRequestType } from "@glade/contracts/provider/runtimeMetadata";
import type {
  ProviderApprovalDecision,
  ProviderUserInputAnswers,
  RuntimeMode,
} from "@glade/contracts/provider/sessionPolicy";

import type { RuntimeEventDraft } from "../core/runtimeEventDraft.ts";
import { mintMspCommandId } from "./mspCommandId.ts";
import { callMsp, type MspConnection } from "./mspConnection.ts";
import {
  MspApprovalDecideResult,
  type MspApprovalChoice,
  type MspApprovalRequest,
  type MspUserInputRequest,
} from "./mspProtocol.ts";

interface PendingApproval {
  readonly request: MspApprovalRequest;
  readonly requestType: CanonicalRequestType;
}

interface PendingUserInput {
  readonly request: MspUserInputRequest;
}

export interface MuseInteractions {
  readonly presentApproval: (request: MspApprovalRequest) => void;
  readonly approvalResolved: (approvalId: string, decision: string) => void;
  readonly decideApproval: (
    requestId: string,
    decision: ProviderApprovalDecision,
  ) => Promise<boolean>;
  readonly presentUserInput: (request: MspUserInputRequest) => void;
  readonly userInputSettled: (userInputId: string) => void;
  readonly answerUserInput: (
    requestId: string,
    answers: ProviderUserInputAnswers,
  ) => Promise<boolean>;
  // Settles every open interaction in Glade; the host settles its side when the turn ends.
  readonly settleAll: () => void;
}

function requestTypeFor(subject: MspApprovalRequest["subject"]): CanonicalRequestType {
  switch (subject.kind) {
    case "shell":
    case "process":
      return "command_execution_approval";
    case "fileAccess":
      return subject.access === "read" ? "file_read_approval" : "file_change_approval";
    default:
      return "tool_approval";
  }
}

function subjectDetail(request: MspApprovalRequest): string | undefined {
  const { subject } = request;
  const host = subject.host ? `${subject.host}${subject.port ? `:${subject.port}` : ""}` : "";
  const detail =
    subject.command ??
    subject.path ??
    (host || subject.target) ??
    subject.toolName ??
    request.toolName;
  return detail.trim() || undefined;
}

function parseArgs(rawArgs: string): unknown {
  try {
    return JSON.parse(rawArgs);
  } catch {
    return rawArgs;
  }
}

// A Glade decision picks one of the host's offered choices. Glade only ever answers for this call or
// this session: it never selects a choice that persists a rule beyond the session.
function choiceFor(
  choices: ReadonlyArray<MspApprovalChoice>,
  decision: ProviderApprovalDecision,
): MspApprovalChoice | undefined {
  const pick = (wanted: string, scope?: string) =>
    choices.find((choice) => choice.decision === wanted && (!scope || choice.scope === scope));
  switch (decision) {
    case "accept":
      return pick("approved", "once");
    case "acceptForSession":
      return pick("approvedForSession", "session") ?? pick("approved", "once");
    case "decline":
      return pick("denied", "once") ?? pick("denied");
    case "cancel":
      return pick("abort") ?? pick("denied", "once") ?? pick("denied");
  }
}

function decisionFromHost(decision: string): string {
  if (decision === "approved" || decision === "approvedForSession") return "accept";
  if (decision === "denied") return "decline";
  return "cancel";
}

function answerFor(
  questionId: string,
  value: ProviderUserInputAnswers[string] | undefined,
  options: ReadonlyArray<string>,
) {
  if (value === null || value === undefined) return undefined;
  if (typeof value !== "string") {
    const labels = value.filter((entry) => options.includes(entry));
    return labels.length > 0 ? { questionId, selectedLabels: labels } : undefined;
  }
  const text = value.trim();
  if (!text) return undefined;
  return options.includes(text)
    ? { questionId, selectedLabel: text }
    : { questionId, freeText: text };
}

export function makeMuseInteractions(input: {
  readonly connection: Pick<MspConnection, "request">;
  readonly sessionId: string;
  readonly runtimeMode: RuntimeMode;
  readonly emit: (draft: RuntimeEventDraft, turnId: string | undefined) => void;
}): MuseInteractions {
  const { connection, sessionId, emit } = input;
  const approvals = new Map<string, PendingApproval>();
  const userInputs = new Map<string, PendingUserInput>();
  // The host presents an approval stage both as a request and on the view stream.
  const presentedStages = new Set<string>();

  const decide = (request: MspApprovalRequest, choice: MspApprovalChoice) =>
    callMsp(
      connection,
      "approval/decide",
      {
        sessionId,
        approvalId: request.approvalId,
        choiceId: choice.choiceId,
        requirementId: request.currentRequirementId,
        commandId: mintMspCommandId(),
      },
      MspApprovalDecideResult,
    );

  const resolveApproval = (requestId: string, decision: string) => {
    const pending = approvals.get(requestId);
    if (!pending) return;
    approvals.delete(requestId);
    emit(
      {
        type: "request.resolved",
        requestId: RuntimeRequestId.makeUnsafe(requestId),
        payload: { requestType: pending.requestType, decision },
      },
      pending.request.turnId,
    );
  };

  const resolveUserInput = (requestId: string, answers: Record<string, unknown>) => {
    const pending = userInputs.get(requestId);
    if (!pending) return;
    userInputs.delete(requestId);
    emit(
      {
        type: "user-input.resolved",
        requestId: RuntimeRequestId.makeUnsafe(requestId),
        payload: { answers },
      },
      pending.request.turnId,
    );
  };

  return {
    presentApproval: (request) => {
      const stage = `${request.approvalId}:${request.currentRequirementId.sourceIndex}`;
      if (presentedStages.has(stage)) return;
      presentedStages.add(stage);
      if (input.runtimeMode === "full-access") {
        // Full Access runs without prompts; anything the host still asks about is allowed once.
        const choice = choiceFor(request.availableChoices, "accept");
        if (choice) void decide(request, choice).catch(() => undefined);
        return;
      }
      const requestId = randomUUID();
      const requestType = requestTypeFor(request.subject);
      approvals.set(requestId, { request, requestType });
      const detail = subjectDetail(request);
      emit(
        {
          type: "request.opened",
          requestId: RuntimeRequestId.makeUnsafe(requestId),
          payload: {
            requestType,
            ...(detail ? { detail } : {}),
            args: {
              toolCallId: request.toolCallId,
              toolName: request.toolName,
              input: parseArgs(request.rawArgs),
              ...(request.subject.command ? { command: request.subject.command } : {}),
              ...(request.subject.path ? { path: request.subject.path } : {}),
              sessionApprovalAvailable: request.availableChoices.some(
                (choice) => choice.decision === "approvedForSession" && choice.scope === "session",
              ),
            },
          },
        },
        request.turnId,
      );
    },
    approvalResolved: (approvalId, decision) => {
      for (const [requestId, pending] of approvals) {
        if (pending.request.approvalId === approvalId) {
          resolveApproval(requestId, decisionFromHost(decision));
        }
      }
    },
    decideApproval: async (requestId, decision) => {
      const pending = approvals.get(requestId);
      if (!pending) return false;
      const choice = choiceFor(pending.request.availableChoices, decision);
      if (!choice) throw new Error(`Muse Code offered no choice for "${decision}".`);
      resolveApproval(requestId, decision);
      await decide(pending.request, choice);
      return true;
    },
    presentUserInput: (request) => {
      for (const pending of userInputs.values()) {
        if (pending.request.userInputId === request.userInputId) return;
      }
      const requestId = randomUUID();
      userInputs.set(requestId, { request });
      emit(
        {
          type: "user-input.requested",
          requestId: RuntimeRequestId.makeUnsafe(requestId),
          payload: {
            questions: request.questions.map((question) => ({
              id: question.id,
              header: question.header.trim() || question.question,
              question: question.question,
              options: question.options.map((option) => ({
                label: option.label,
                description: option.description?.trim() || option.label,
              })),
              multiSelect: question.selection.mode === "multiple",
            })),
          },
        },
        request.turnId,
      );
    },
    userInputSettled: (userInputId) => {
      for (const [requestId, pending] of userInputs) {
        if (pending.request.userInputId === userInputId) resolveUserInput(requestId, {});
      }
    },
    answerUserInput: async (requestId, answers) => {
      const pending = userInputs.get(requestId);
      if (!pending) return false;
      const { request } = pending;
      const wireAnswers = request.questions.flatMap((question) => {
        const answer = answerFor(
          question.id,
          answers[question.id],
          question.options.map((option) => option.label),
        );
        return answer ? [answer] : [];
      });
      resolveUserInput(requestId, answers);
      const commandId = mintMspCommandId();
      await connection.request(
        wireAnswers.length > 0 ? "userInput/answer" : "userInput/cancel",
        wireAnswers.length > 0
          ? { sessionId, userInputId: request.userInputId, commandId, answers: wireAnswers }
          : { sessionId, userInputId: request.userInputId, commandId },
      );
      return true;
    },
    settleAll: () => {
      for (const requestId of [...approvals.keys()]) resolveApproval(requestId, "cancel");
      for (const requestId of [...userInputs.keys()]) resolveUserInput(requestId, {});
    },
  };
}
