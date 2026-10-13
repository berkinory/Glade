import { Option, Schema } from "effect";

// The subset of the Muse Session Protocol (MSP v1) that Glade reads. Each schema keeps only the fields
// Glade uses; extra fields are ignored so additive host changes keep decoding.

const RequirementRef = Schema.Struct({ approvalId: Schema.String, sourceIndex: Schema.Number });

const SessionSnapshot = Schema.Struct({
  sessionId: Schema.String,
  modelId: Schema.NullOr(Schema.String),
  approvalMode: Schema.optional(Schema.Struct({ mode: Schema.String })),
  permissionState: Schema.optional(Schema.Struct({ profileId: Schema.String })),
});

export const MspInitializeResult = Schema.Struct({
  schema: Schema.Struct({ version: Schema.Number }),
  grantedCapabilities: Schema.Array(Schema.String),
});
export type MspInitializeResult = typeof MspInitializeResult.Type;

export const MspSessionOpened = Schema.Struct({ session: SessionSnapshot });

export const MspTurnStartResult = Schema.Struct({
  turnId: Schema.String,
  disposition: Schema.String,
});

export const MspApprovalDecideResult = Schema.Struct({ terminal: Schema.Boolean });

export const MspAccountState = Schema.Struct({
  state: Schema.String,
  credentialRequired: Schema.Boolean,
  label: Schema.optional(Schema.String),
});

const ReasoningEffortTier = Schema.Struct({
  tier: Schema.String,
  description: Schema.optional(Schema.String),
});

const ModelCatalogEntry = Schema.Struct({
  modelId: Schema.String,
  displayLabel: Schema.String,
  description: Schema.NullOr(Schema.String),
  isDefault: Schema.Boolean,
  defaultReasoningEffort: Schema.optional(Schema.String),
  // A list of tiers, or "unknown" when the catalog does not describe them.
  variants: Schema.optional(Schema.Unknown),
  reasoningEffortVariants: Schema.optional(Schema.Array(ReasoningEffortTier)),
});
export type MspModelCatalogEntry = typeof ModelCatalogEntry.Type;

export const MspModelListResult = Schema.Struct({ models: Schema.Array(ModelCatalogEntry) });

export const MspSkillListResult = Schema.Struct({
  skills: Schema.Array(
    Schema.Struct({
      selector: Schema.String,
      description: Schema.String,
      argumentHint: Schema.optional(Schema.String),
    }),
  ),
});
export type MspSkill = (typeof MspSkillListResult.Type)["skills"][number];

const Item = Schema.Struct({
  itemId: Schema.String,
  kind: Schema.String,
  status: Schema.String,
  turnId: Schema.optional(Schema.NullOr(Schema.String)),
  text: Schema.optional(Schema.String),
  summary: Schema.optional(Schema.Array(Schema.String)),
  tool: Schema.optional(Schema.String),
  callId: Schema.optional(Schema.String),
  args: Schema.optional(Schema.String),
  visibleOutput: Schema.optional(Schema.String),
  exitCode: Schema.optional(Schema.Number),
  failureReason: Schema.optional(Schema.String),
  objective: Schema.optional(Schema.String),
  role: Schema.optional(Schema.String),
  outcome: Schema.optional(Schema.String),
  fallbackText: Schema.optional(Schema.String),
  patchSummary: Schema.optional(
    Schema.Struct({ added: Schema.Number, removed: Schema.Number, files: Schema.Number }),
  ),
});
export type MspItem = typeof Item.Type;

export const MspItemEvent = Schema.Struct({ item: Item });

export const MspItemDelta = Schema.Struct({
  itemId: Schema.String,
  field: Schema.optional(Schema.String),
  delta: Schema.String,
});

const TokenUsage = Schema.Struct({
  inputTokens: Schema.Number,
  outputTokens: Schema.Number,
  cachedTokens: Schema.Number,
  reasoningTokens: Schema.Number,
});
export type MspTokenUsage = typeof TokenUsage.Type;

export const MspTurnCompleted = Schema.Struct({
  turnId: Schema.String,
  terminal: Schema.String,
  reason: Schema.optional(Schema.String),
  error: Schema.optional(
    Schema.Struct({
      kind: Schema.String,
      message: Schema.String,
      retryable: Schema.Boolean,
      quota: Schema.optional(Schema.Struct({ resetsAtMs: Schema.Number })),
    }),
  ),
});
export type MspTurnCompleted = typeof MspTurnCompleted.Type;

export const MspTurnRetryScheduled = Schema.Struct({
  turnId: Schema.String,
  attempt: Schema.Number,
  maxAttempts: Schema.Number,
  retryDelayMs: Schema.Number,
  reason: Schema.String,
  httpStatus: Schema.optional(Schema.Number),
});

export const MspTokenUsageChanged = Schema.Struct({ usage: TokenUsage });

export const MspContextUsage = Schema.Struct({
  usedTokens: Schema.Number,
  windowTokens: Schema.optional(Schema.Number),
});

const ApprovalChoice = Schema.Struct({
  choiceId: Schema.String,
  decision: Schema.String,
  scope: Schema.String,
});
export type MspApprovalChoice = typeof ApprovalChoice.Type;

export const MspApprovalRequest = Schema.Struct({
  approvalId: Schema.String,
  turnId: Schema.String,
  toolName: Schema.String,
  toolCallId: Schema.String,
  rawArgs: Schema.String,
  currentRequirementId: RequirementRef,
  availableChoices: Schema.Array(ApprovalChoice),
  subject: Schema.Struct({
    kind: Schema.String,
    access: Schema.optional(Schema.String),
    command: Schema.optional(Schema.String),
    path: Schema.optional(Schema.String),
    host: Schema.optional(Schema.String),
    port: Schema.optional(Schema.Number),
    target: Schema.optional(Schema.String),
    toolName: Schema.optional(Schema.String),
  }),
});
export type MspApprovalRequest = typeof MspApprovalRequest.Type;

export const MspApprovalResolved = Schema.Struct({
  approvalId: Schema.String,
  decision: Schema.String,
});

export const MspUserInputRequest = Schema.Struct({
  userInputId: Schema.String,
  turnId: Schema.String,
  questions: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      header: Schema.String,
      question: Schema.String,
      options: Schema.Array(
        Schema.Struct({ label: Schema.String, description: Schema.optional(Schema.String) }),
      ),
      selection: Schema.Struct({ mode: Schema.String }),
    }),
  ),
});
export type MspUserInputRequest = typeof MspUserInputRequest.Type;

export const MspUserInputSettled = Schema.Struct({ userInputId: Schema.String });

export function decodeMsp<S extends Schema.Top & { readonly DecodingServices: never }>(
  schema: S,
  value: unknown,
): S["Type"] | undefined {
  return Option.getOrUndefined(Schema.decodeUnknownOption(schema)(value));
}
