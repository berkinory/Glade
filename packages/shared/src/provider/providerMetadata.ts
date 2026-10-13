import { PROVIDER_DISPLAY_NAMES } from "@glade/contracts/provider/model";
import { type ProviderKind } from "@glade/contracts/core/baseSchemas";

// Glade features whose behavior depends on what the provider does natively. Shared code reads these
// instead of branching on a provider kind.
export interface ProviderCapabilities {
  // Input sent during a live turn joins that turn natively instead of queueing for the next one.
  readonly turnSteering: boolean;
  // The provider can ask a question that the user answers later, outside the blocking request flow.
  readonly asyncUserInput: boolean;
  // How a native fork names its boundary: the turn that produced the message, or the message itself.
  readonly forkBoundary: "turn" | "message" | "none";
  // Session settings can change while a turn is running.
  readonly reconfiguresDuringActiveTurn: boolean;
  // `rpc` compacts through a native call. `promptTurn` compacts by running a `/compact` turn, so it is
  // admitted and cancelled like a turn.
  readonly compaction: "rpc" | "promptTurn" | "none";
  // The prefix the provider expects when a message invokes a skill by name.
  readonly skillMentionPrefix: "$" | "/";
  // A resolved send confirms the provider accepted the turn. Otherwise acceptance is observed later.
  readonly sendTurnConfirmsAcceptance: boolean;
  // `streaming` providers send readable reasoning as it is produced and Glade previews it while it
  // grows; `completed` providers only show reasoning once its item completes.
  readonly reasoningPreview: "streaming" | "completed";
  // The adapter settles its own pending approvals and questions when a turn ends.
  readonly ownsInteractionSettlement: boolean;
  // `native` providers handle session commands such as clear, compact, model and fast through their
  // own slash commands, so Glade does not offer its versions of them.
  readonly sessionSlashCommands: "glade" | "native";
  // The provider runs code review natively instead of through a review prompt.
  readonly nativeReview: boolean;
  // The provider reports whether it actually serves fast mode; the selection is only a request.
  readonly reportsFastModeAvailability: boolean;
  // The provider can transcribe voice notes.
  readonly voiceTranscription: boolean;
}

export interface ProviderDescriptor {
  readonly kind: ProviderKind;
  readonly displayName: string;
  readonly available: boolean;
  readonly capabilities: ProviderCapabilities;
  // Native slash command aliases, keyed by the canonical command name.
  readonly nativeCommandAliases: Readonly<Record<string, readonly string[]>>;

  readonly setupDocsHref: string;
  readonly usage: {
    readonly signInCommand: string;
    readonly learnMoreHref: string;
  } | null;
}

type ExhaustiveProviderDescriptors<Descriptors extends readonly ProviderDescriptor[]> =
  Exclude<ProviderKind, Descriptors[number]["kind"]> extends never ? Descriptors : never;

function defineProviderDescriptors<const Descriptors extends readonly ProviderDescriptor[]>(
  descriptors: ExhaustiveProviderDescriptors<Descriptors>,
): Descriptors {
  return descriptors;
}

export const PROVIDER_DESCRIPTORS = defineProviderDescriptors([
  {
    kind: "codex",
    displayName: PROVIDER_DISPLAY_NAMES.codex,
    available: true,
    setupDocsHref: "https://github.com/berkinory/Glade/blob/main/docs/providers.md",
    capabilities: {
      turnSteering: true,
      asyncUserInput: true,
      forkBoundary: "turn",
      reconfiguresDuringActiveTurn: true,
      compaction: "rpc",
      skillMentionPrefix: "$",
      sendTurnConfirmsAcceptance: true,
      reasoningPreview: "completed",
      ownsInteractionSettlement: false,
      sessionSlashCommands: "glade",
      nativeReview: true,
      reportsFastModeAvailability: false,
      voiceTranscription: true,
    },
    nativeCommandAliases: {},
    usage: {
      signInCommand: "codex login",
      learnMoreHref: "https://platform.openai.com/usage",
    },
  },
  {
    kind: "claudeAgent",
    displayName: PROVIDER_DISPLAY_NAMES.claudeAgent,
    available: true,
    setupDocsHref: "https://github.com/berkinory/Glade/blob/main/docs/providers.md",
    capabilities: {
      turnSteering: true,
      asyncUserInput: false,
      forkBoundary: "message",
      reconfiguresDuringActiveTurn: false,
      compaction: "promptTurn",
      skillMentionPrefix: "/",
      sendTurnConfirmsAcceptance: false,
      reasoningPreview: "streaming",
      ownsInteractionSettlement: true,
      sessionSlashCommands: "native",
      nativeReview: false,
      reportsFastModeAvailability: true,
      voiceTranscription: false,
    },
    nativeCommandAliases: {
      clear: ["reset", "new"],
      config: ["settings"],
      desktop: ["app"],
      exit: ["quit"],
      feedback: ["bug"],
      mobile: ["ios", "android"],
      permissions: ["allowed-tools"],
      "remote-control": ["rc"],
      resume: ["continue"],
    },
    usage: {
      signInCommand: "claude",
      learnMoreHref: "https://docs.anthropic.com/en/docs/about-claude/models#rate-limits",
    },
  },
] as const satisfies readonly ProviderDescriptor[]);

export const PROVIDER_DESCRIPTOR_BY_KIND = Object.fromEntries(
  PROVIDER_DESCRIPTORS.map((descriptor) => [descriptor.kind, descriptor]),
) as Record<ProviderKind, (typeof PROVIDER_DESCRIPTORS)[number]>;

// A provider this build does not know has no adapter, so none of its native features are available.
const UNKNOWN_PROVIDER_CAPABILITIES: ProviderCapabilities = {
  turnSteering: false,
  asyncUserInput: false,
  forkBoundary: "none",
  reconfiguresDuringActiveTurn: false,
  compaction: "none",
  skillMentionPrefix: "/",
  sendTurnConfirmsAcceptance: false,
  reasoningPreview: "completed",
  ownsInteractionSettlement: false,
  sessionSlashCommands: "glade",
  nativeReview: false,
  reportsFastModeAvailability: false,
  voiceTranscription: false,
};

export function providerNativeCommandAliases(
  kind: string,
): Readonly<Record<string, readonly string[]>> {
  return (
    PROVIDER_DESCRIPTORS.find((descriptor) => descriptor.kind === kind)?.nativeCommandAliases ?? {}
  );
}

export function providerCapabilities(kind: string): ProviderCapabilities {
  return (
    PROVIDER_DESCRIPTORS.find((descriptor) => descriptor.kind === kind)?.capabilities ??
    UNKNOWN_PROVIDER_CAPABILITIES
  );
}
