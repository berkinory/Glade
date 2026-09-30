import { ThreadId } from "@glade/contracts/core/baseSchemas";
import { ClaudeSessionContext, PROVIDER } from "./sessionTypes";
import { Effect, Option } from "effect";
import { readInstalledClaudeCliVersion } from "./sdkProcessRuntime";
import {
  type ProviderAdapterError,
  ProviderAdapterSessionNotFoundError,
  ProviderAdapterSessionClosedError,
  ProviderAdapterValidationError,
} from "../../core/Errors.ts";
import { hasActiveClaudeRuntimeWork } from "./sessionResume";
import { isClaudeNativeSlashCommand } from "./commandPresentation";
import { type ClaudeAdapterShape } from "../../Services/ClaudeAdapter.ts";
import { toMessage } from "./streamErrors";
import {
  isClaudeAutoModeCliVersionSupported,
  MINIMUM_CLAUDE_AUTO_MODE_CLI_VERSION,
} from "../claudeCliVersion.ts";
import { compareSemverVersions } from "../../core/providerMaintenance.ts";

const CLAUDE_NATIVE_COMMAND_LOOKUP_TIMEOUT_MS = 2_000;

export function makeClaudeSessionAccess(input: {
  readonly sessions: Map<ThreadId, ClaudeSessionContext>;
  readonly resolveClaudeSdkEnv: Effect.Effect<NodeJS.ProcessEnv>;
  readonly readClaudeCliVersion: typeof readInstalledClaudeCliVersion;
}) {
  const { sessions, resolveClaudeSdkEnv, readClaudeCliVersion } = input;
  const requireSession = (
    threadId: ThreadId,
  ): Effect.Effect<ClaudeSessionContext, ProviderAdapterError> => {
    const context = sessions.get(threadId);
    if (!context) {
      return Effect.fail(
        new ProviderAdapterSessionNotFoundError({
          provider: PROVIDER,
          threadId,
        }),
      );
    }
    if (context.stopped || context.session.status === "closed") {
      return Effect.fail(
        new ProviderAdapterSessionClosedError({
          provider: PROVIDER,
          threadId,
        }),
      );
    }
    return Effect.succeed(context);
  };

  const assertSessionReplaceable = (threadId: ThreadId) =>
    Effect.suspend(() => {
      const context = sessions.get(threadId);
      return context && (context.pendingDispatches || hasActiveClaudeRuntimeWork(context))
        ? Effect.fail(
            new ProviderAdapterValidationError({
              provider: PROVIDER,
              operation: "session/reconfigure",
              issue:
                "Wait for Claude's active turn, shared tasks, approvals and questions to finish before changing session settings.",
            }),
          )
        : Effect.void;
    });

  const resolveNativeCommandNames = (
    context: ClaudeSessionContext,
    text: string | undefined,
  ): Effect.Effect<ReadonlySet<string> | undefined> =>
    isClaudeNativeSlashCommand(text)
      ? Effect.tryPromise(() => context.query.supportedCommands()).pipe(
          Effect.timeoutOption(CLAUDE_NATIVE_COMMAND_LOOKUP_TIMEOUT_MS),
          Effect.map((commands) =>
            Option.isSome(commands)
              ? new Set(
                  commands.value.flatMap((command) => [command.name, ...(command.aliases ?? [])]),
                )
              : undefined,
          ),
          Effect.orElseSucceed(() => undefined),
        )
      : Effect.succeed(undefined);

  const resolveClaudeStartPreflight = (input: Parameters<ClaudeAdapterShape["startSession"]>[0]) =>
    Effect.gen(function* () {
      const claudeSdkEnv = yield* resolveClaudeSdkEnv;
      if (input.runtimeMode !== "auto") return { claudeSdkEnv, snapshotSupported: false };
      const binaryPath = input.providerOptions?.claudeAgent?.binaryPath ?? "claude";
      const installedVersion = yield* Effect.tryPromise({
        try: () =>
          readClaudeCliVersion({
            binaryPath,
            ...(input.cwd ? { cwd: input.cwd } : {}),
            env: claudeSdkEnv,
          }),
        catch: (cause) =>
          new ProviderAdapterValidationError({
            provider: PROVIDER,
            operation: "startSession",
            issue: `Could not verify Auto mode support for Claude CLI at "${binaryPath}": ${toMessage(cause, "version probe failed")}`,
          }),
      });
      if (!isClaudeAutoModeCliVersionSupported(installedVersion)) {
        return yield* new ProviderAdapterValidationError({
          provider: PROVIDER,
          operation: "startSession",
          issue:
            installedVersion === null
              ? `Could not determine whether Claude CLI at "${binaryPath}" supports Auto mode.`
              : `Claude CLI ${installedVersion} at "${binaryPath}" does not support Auto mode; upgrade to ${MINIMUM_CLAUDE_AUTO_MODE_CLI_VERSION} or newer.`,
        });
      }
      return {
        claudeSdkEnv,
        snapshotSupported:
          installedVersion !== null && compareSemverVersions(installedVersion, "2.1.267") >= 0,
      };
    });
  return {
    resolveClaudeStartPreflight,
    assertSessionReplaceable,
    requireSession,
    resolveNativeCommandNames,
  };
}
