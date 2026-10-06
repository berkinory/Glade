import { ClaudeSessionRegistry } from "../Services/ClaudeSessionRegistry.ts";
import {
  ClaudeSessionAccess,
  type ClaudeSessionAccessShape,
} from "../Services/ClaudeSessionAccess.ts";
import { ThreadId } from "@glade/contracts/core/baseSchemas";
import { ClaudeSessionContext, PROVIDER } from "../claude/adapter/sessionTypes";
import { Effect, Layer, Option } from "effect";
import { readInstalledClaudeCliVersion } from "../claude/adapter/sdkProcessRuntime";
import type { ClaudeAdapterLiveOptions } from "../claude/adapter/adapterConfiguration";
import { buildClaudeProcessEnv } from "../claude/claudeProcessEnv.ts";
import { ServerConfig } from "../../server/config.ts";
import {
  type ProviderAdapterError,
  ProviderAdapterSessionNotFoundError,
  ProviderAdapterSessionClosedError,
  ProviderAdapterValidationError,
} from "../core/Errors.ts";
import { hasActiveClaudeRuntimeWork } from "../claude/adapter/sessionResume";
import { isClaudeNativeSlashCommand } from "../claude/adapter/commandPresentation";
import { type ClaudeAdapterShape } from "../Services/ClaudeAdapter.ts";
import { toMessage } from "../claude/adapter/streamErrors";
import { isProviderVersionSupported, providerUpgradeMessage } from "../core/compatibility.ts";
import { resolveExecutable } from "@glade/shared/platform/executable";
import { cliBinaryFingerprint, makeCliVersionGate } from "../core/cliVersionGate.ts";

const CLAUDE_NATIVE_COMMAND_LOOKUP_TIMEOUT_MS = 2_000;

export function makeClaudeSessionAccessLive(options?: ClaudeAdapterLiveOptions) {
  return Layer.effect(
    ClaudeSessionAccess,
    Effect.gen(function* () {
      const sessions = yield* ClaudeSessionRegistry;
      const serverConfig = yield* ServerConfig;
      const resolveClaudeSdkEnv = Effect.sync(() =>
        buildClaudeProcessEnv({ homeDir: serverConfig.homeDir }),
      );
      const readClaudeCliVersion = options?.readClaudeCliVersion ?? readInstalledClaudeCliVersion;
      const versionGate = makeCliVersionGate({
        isSupported: (version) => isProviderVersionSupported(PROVIDER, version),
      });
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
                      commands.value.flatMap((command) => [
                        command.name,
                        ...(command.aliases ?? []),
                      ]),
                    )
                  : undefined,
              ),
              Effect.orElseSucceed(() => undefined),
            )
          : Effect.succeed(undefined);

      const resolveClaudeStartPreflight = (
        input: Parameters<ClaudeAdapterShape["startSession"]>[0],
      ) =>
        Effect.gen(function* () {
          const claudeSdkEnv = yield* resolveClaudeSdkEnv;
          const binaryPath = input.providerOptions?.claudeAgent?.binaryPath ?? "claude";
          const resolvedBinaryPath = resolveExecutable(binaryPath, {
            env: claudeSdkEnv,
            ...(input.cwd ? { cwd: input.cwd } : {}),
          });
          if (!resolvedBinaryPath) {
            return yield* new ProviderAdapterValidationError({
              provider: PROVIDER,
              operation: "startSession",
              issue: `Claude CLI at "${binaryPath}" was not found or is not executable.`,
            });
          }
          const fingerprint = cliBinaryFingerprint(resolvedBinaryPath);
          const installedVersion = yield* Effect.tryPromise({
            try: () =>
              versionGate.check(
                JSON.stringify([resolvedBinaryPath, claudeSdkEnv.PATH ?? ""]),
                async () => ({
                  version: await readClaudeCliVersion({
                    binaryPath: resolvedBinaryPath,
                    ...(input.cwd ? { cwd: input.cwd } : {}),
                    env: claudeSdkEnv,
                  }),
                  fingerprint,
                }),
              ),
            catch: (cause) =>
              new ProviderAdapterValidationError({
                provider: PROVIDER,
                operation: "startSession",
                issue: `Could not verify Claude CLI at "${binaryPath}": ${toMessage(cause, "version probe failed")}`,
              }),
          });
          if (!isProviderVersionSupported(PROVIDER, installedVersion)) {
            return yield* new ProviderAdapterValidationError({
              provider: PROVIDER,
              operation: "startSession",
              issue: providerUpgradeMessage(PROVIDER, installedVersion),
            });
          }
          return {
            claudeSdkEnv,
            binaryPath: resolvedBinaryPath,
            snapshotSupported: true,
          };
        });
      return {
        resolveClaudeStartPreflight,
        assertSessionReplaceable,
        requireSession,
        resolveNativeCommandNames,
      } satisfies ClaudeSessionAccessShape;
    }),
  );
}
