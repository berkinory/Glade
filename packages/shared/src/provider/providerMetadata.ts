import { PROVIDER_DISPLAY_NAMES } from "@glade/contracts/provider/model";
import { type ProviderKind } from "@glade/contracts/core/baseSchemas";

// Glade features whose behavior depends on what the provider does natively. Shared code reads these
// instead of branching on a provider kind.
export interface ProviderCapabilities {
  // Input sent during a live turn joins that turn natively instead of queueing for the next one.
  readonly turnSteering: boolean;
  // The provider can ask a question that the user answers later, outside the blocking request flow.
  readonly asyncUserInput: boolean;
  // How a fork names its boundary: a native fork at the turn that produced the message or at the
  // message itself, or a transcript fork, which copies the chat up to any finished reply and starts
  // the fork's native session fresh with that transcript as context.
  readonly forkBoundary: "turn" | "message" | "transcript" | "none";
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
  // `provider`: every model can run in Auto runtime mode. `model`: only a model whose descriptor
  // confirms `supportsAutoMode`. `none`: Auto runtime mode is unavailable.
  readonly autoRuntimeMode: "provider" | "model" | "none";
}

export interface ProviderDescriptor {
  readonly kind: ProviderKind;
  readonly displayName: string;
  readonly available: boolean;
  readonly capabilities: ProviderCapabilities;
  // Native slash command aliases, keyed by the canonical command name.
  readonly nativeCommandAliases: Readonly<Record<string, readonly string[]>>;
  // Model slugs that ask for the provider's native default model instead of naming one.
  readonly inheritedModelSlugs: readonly string[];

  readonly setupDocsHref: string;
  // The provider's own install, update and configuration pages, linked from its settings row.
  readonly installDocs: readonly { readonly label: string; readonly href: string }[];
  readonly usage: {
    readonly signInCommand: string;
    readonly learnMoreHref: string;
    // The provider's id in OpenUsage (openusage.ai), read when Glade has no native usage reader.
    readonly openUsageId?: string;
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
    installDocs: [
      { label: "Install", href: "https://developers.openai.com/codex/cli" },
      { label: "Update", href: "https://developers.openai.com/codex/cli" },
      { label: "Config", href: "https://github.com/openai/codex/blob/main/docs/config.md" },
    ],
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
      autoRuntimeMode: "provider",
    },
    nativeCommandAliases: {},
    inheritedModelSlugs: [],
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
    installDocs: [
      { label: "Install", href: "https://code.claude.com/docs/en/installation" },
      { label: "Update", href: "https://code.claude.com/docs/en/installation#update-claude-code" },
      { label: "Config", href: "https://code.claude.com/docs/en/settings" },
    ],
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
      autoRuntimeMode: "model",
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
    inheritedModelSlugs: ["default"],
    usage: {
      signInCommand: "claude",
      learnMoreHref: "https://docs.anthropic.com/en/docs/about-claude/models#rate-limits",
    },
  },
  {
    kind: "cursor",
    displayName: PROVIDER_DISPLAY_NAMES.cursor,
    available: true,
    setupDocsHref: "https://github.com/berkinory/Glade/blob/main/docs/providers.md",
    installDocs: [
      { label: "Install", href: "https://cursor.com/docs/cli/installation" },
      { label: "CLI guide", href: "https://cursor.com/docs/cli/overview" },
    ],
    capabilities: {
      turnSteering: false,
      asyncUserInput: false,
      forkBoundary: "transcript",
      reconfiguresDuringActiveTurn: false,
      compaction: "none",
      skillMentionPrefix: "/",
      sendTurnConfirmsAcceptance: false,
      reasoningPreview: "streaming",
      ownsInteractionSettlement: true,
      sessionSlashCommands: "glade",
      nativeReview: false,
      reportsFastModeAvailability: false,
      voiceTranscription: false,
      autoRuntimeMode: "none",
    },
    nativeCommandAliases: {},
    inheritedModelSlugs: [],
    usage: {
      signInCommand: "cursor-agent login",
      learnMoreHref: "https://cursor.com/dashboard?tab=usage",
      openUsageId: "cursor",
    },
  },
  {
    kind: "factoryDroid",
    displayName: PROVIDER_DISPLAY_NAMES.factoryDroid,
    available: true,
    setupDocsHref: "https://github.com/berkinory/Glade/blob/main/docs/providers.md",
    installDocs: [
      { label: "Install", href: "https://docs.factory.com/droid-cli/quickstart" },
      { label: "CLI guide", href: "https://docs.factory.com/droid-cli/overview" },
    ],
    capabilities: {
      turnSteering: false,
      asyncUserInput: false,
      forkBoundary: "transcript",
      reconfiguresDuringActiveTurn: false,
      compaction: "none",
      skillMentionPrefix: "/",
      sendTurnConfirmsAcceptance: false,
      reasoningPreview: "streaming",
      ownsInteractionSettlement: true,
      sessionSlashCommands: "glade",
      nativeReview: false,
      reportsFastModeAvailability: false,
      voiceTranscription: false,
      autoRuntimeMode: "none",
    },
    nativeCommandAliases: {},
    inheritedModelSlugs: [],
    usage: null,
  },
  {
    kind: "grok",
    displayName: PROVIDER_DISPLAY_NAMES.grok,
    available: true,
    setupDocsHref: "https://github.com/berkinory/Glade/blob/main/docs/providers.md",
    installDocs: [{ label: "Install", href: "https://docs.x.ai/build/overview" }],
    capabilities: {
      turnSteering: false,
      asyncUserInput: false,
      forkBoundary: "transcript",
      reconfiguresDuringActiveTurn: false,
      compaction: "none",
      skillMentionPrefix: "/",
      sendTurnConfirmsAcceptance: false,
      reasoningPreview: "streaming",
      ownsInteractionSettlement: true,
      sessionSlashCommands: "glade",
      nativeReview: false,
      reportsFastModeAvailability: false,
      voiceTranscription: false,
      autoRuntimeMode: "none",
    },
    nativeCommandAliases: {},
    inheritedModelSlugs: [],
    usage: {
      signInCommand: "grok login",
      learnMoreHref: "https://grok.com",
      openUsageId: "grok",
    },
  },
  {
    kind: "museCode",
    displayName: PROVIDER_DISPLAY_NAMES.museCode,
    available: true,
    setupDocsHref: "https://github.com/berkinory/Glade/blob/main/docs/providers.md",
    installDocs: [
      { label: "Install", href: "https://ai.developer.meta.com/docs/muse-code/" },
      { label: "Overview", href: "https://developer.meta.com/ai/products/muse-code/" },
    ],
    capabilities: {
      turnSteering: false,
      asyncUserInput: false,
      forkBoundary: "transcript",
      reconfiguresDuringActiveTurn: false,
      compaction: "none",
      skillMentionPrefix: "/",
      sendTurnConfirmsAcceptance: true,
      reasoningPreview: "streaming",
      ownsInteractionSettlement: true,
      sessionSlashCommands: "glade",
      nativeReview: false,
      reportsFastModeAvailability: false,
      voiceTranscription: false,
      autoRuntimeMode: "none",
    },
    nativeCommandAliases: {},
    inheritedModelSlugs: [],
    usage: null,
  },
  {
    kind: "opencode",
    displayName: PROVIDER_DISPLAY_NAMES.opencode,
    available: true,
    setupDocsHref: "https://github.com/berkinory/Glade/blob/main/docs/providers.md",
    installDocs: [
      { label: "Install", href: "https://opencode.ai/docs/" },
      { label: "Update", href: "https://opencode.ai/docs/cli/#upgrade" },
      { label: "Config", href: "https://opencode.ai/docs/config/" },
    ],
    capabilities: {
      turnSteering: false,
      asyncUserInput: false,
      forkBoundary: "transcript",
      reconfiguresDuringActiveTurn: false,
      compaction: "none",
      skillMentionPrefix: "/",
      sendTurnConfirmsAcceptance: false,
      reasoningPreview: "streaming",
      ownsInteractionSettlement: true,
      sessionSlashCommands: "glade",
      nativeReview: false,
      reportsFastModeAvailability: false,
      voiceTranscription: false,
      autoRuntimeMode: "none",
    },
    nativeCommandAliases: {},
    inheritedModelSlugs: [],
    usage: {
      signInCommand: "opencode auth login",
      learnMoreHref: "https://opencode.ai/zen",
      openUsageId: "opencode",
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
  autoRuntimeMode: "none",
};

export function providerNativeCommandAliases(
  kind: string,
): Readonly<Record<string, readonly string[]>> {
  return (
    PROVIDER_DESCRIPTORS.find((descriptor) => descriptor.kind === kind)?.nativeCommandAliases ?? {}
  );
}

export function providerInheritedModelSlugs(kind: string): readonly string[] {
  return (
    PROVIDER_DESCRIPTORS.find((descriptor) => descriptor.kind === kind)?.inheritedModelSlugs ?? []
  );
}

export function providerCapabilities(kind: string): ProviderCapabilities {
  return (
    PROVIDER_DESCRIPTORS.find((descriptor) => descriptor.kind === kind)?.capabilities ??
    UNKNOWN_PROVIDER_CAPABILITIES
  );
}
