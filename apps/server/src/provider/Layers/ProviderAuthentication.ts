import { Effect, Layer } from "effect";
import type { ProviderAuthenticationStatus } from "@glade/contracts/provider/providerAuthentication";
import { prepareProcess } from "@glade/shared/platform/platformProcess";
import { ServerConfig } from "../../server/config";
import { ServerSettingsService } from "../../settings/serverSettings";
import { PtyAdapter, type PtyProcess } from "../../terminal/Services/PTY";
import { teardownProviderProcessTree } from "../../platform/supervisedProcessTeardown";
import { makeKeyedLock } from "../core/keyedLock";
import { buildClaudeProcessEnv } from "../claude/claudeProcessEnv";
import { buildCodexProcessEnv } from "../codex/codexProcessEnv";
import {
  ProviderAuthentication,
  ProviderAuthenticationError,
} from "../Services/ProviderAuthentication";

interface Attempt {
  view: ProviderAuthenticationStatus;
  process: PtyProcess;
  exited: Promise<void>;
  dispose: () => void;
}
const failure = (message: string) => new ProviderAuthenticationError({ message });
const OUTPUT_LIMIT = 64 * 1024;

export const ProviderAuthenticationLive = Layer.effect(
  ProviderAuthentication,
  Effect.gen(function* () {
    const config = yield* ServerConfig;
    const settings = yield* ServerSettingsService;
    const pty = yield* PtyAdapter;
    const attempts = new Map<string, Attempt>();
    const lock = makeKeyedLock<string>();
    const stop = Effect.fn(function* (attempt: Attempt) {
      if (attempt.view.status === "running") {
        yield* Effect.tryPromise({
          try: () =>
            teardownProviderProcessTree({
              rootPid: attempt.process.pid,
              rootExited: attempt.exited,
            }),
          catch: () =>
            failure("Could not verify that the sign-in process stopped. Retry closing it."),
        });
      }
      attempt.dispose();
      attempt.view = { ...attempt.view, output: "", outputOffset: 0 };
    });
    yield* Effect.addFinalizer(() =>
      Effect.forEach(attempts.values(), (attempt) => stop(attempt).pipe(Effect.orDie), {
        discard: true,
      }),
    );

    return {
      request: (input) =>
        lock.withLock(
          input.provider,
          Effect.gen(function* () {
            const attempt = attempts.get(input.provider);
            if (input.action === "status") return attempt?.view ?? null;
            if (input.action === "start") {
              if (attempt) return attempt.view;
              const current = yield* settings.getSettings.pipe(
                Effect.mapError(() => failure("Provider settings could not be loaded.")),
              );
              const provider = current.providers[input.provider];
              if (!provider.enabled)
                return yield* failure("Enable this provider before signing in.");
              const env =
                input.provider === "claudeAgent"
                  ? buildClaudeProcessEnv({ homeDir: config.homeDir })
                  : yield* Effect.tryPromise({
                      try: () =>
                        buildCodexProcessEnv({ homePath: current.providers.codex.homePath }),
                      catch: () =>
                        failure("The configured provider environment could not be loaded."),
                    });
              const command =
                provider.binaryPath.trim() || (input.provider === "codex" ? "codex" : "claude");
              const plan = yield* Effect.try({
                try: () =>
                  prepareProcess(
                    command,
                    input.provider === "codex" ? ["login"] : ["auth", "login"],
                    { env, cwd: config.homeDir, requireExecutable: true },
                  ),
                catch: () =>
                  failure("The configured provider CLI was not found or cannot be launched."),
              });
              // Cancellation after spawn must not leave an unowned authentication process.
              return yield* Effect.uninterruptible(
                Effect.gen(function* () {
                  const process = yield* pty
                    .spawn({
                      shell: plan.command,
                      args: [...plan.args],
                      env,
                      cwd: config.homeDir,
                      cols: input.cols ?? 80,
                      rows: input.rows ?? 20,
                    })
                    .pipe(
                      Effect.mapError(() =>
                        failure("Could not start the provider sign-in terminal."),
                      ),
                    );
                  let resolveExit!: () => void;
                  const exited = new Promise<void>((resolve) => {
                    resolveExit = resolve;
                  });
                  const owned: Attempt = {
                    process,
                    exited,
                    dispose: () => {},
                    view: {
                      id: crypto.randomUUID(),
                      provider: input.provider,
                      status: "running",
                      output: "",
                      outputOffset: 0,
                      exitCode: null,
                      executable: plan.resolvedCommand,
                      home:
                        input.provider === "codex"
                          ? (env.CODEX_HOME ?? `${config.homeDir}/.codex`)
                          : (env.CLAUDE_CONFIG_DIR ?? `${config.homeDir}/.claude`),
                    },
                  };
                  const offData = process.onData((data) => {
                    const output = owned.view.output + data;
                    const discarded = Math.max(0, output.length - OUTPUT_LIMIT);
                    owned.view = {
                      ...owned.view,
                      output: output.slice(discarded),
                      outputOffset: owned.view.outputOffset + discarded,
                    };
                  });
                  const offExit = process.onExit((event) => {
                    owned.view = { ...owned.view, status: "exited", exitCode: event.exitCode };
                    resolveExit();
                  });
                  owned.dispose = () => {
                    offData();
                    offExit();
                  };
                  attempts.set(input.provider, owned);
                  return owned.view;
                }),
              );
            }
            if (!attempt || input.id !== attempt.view.id)
              return yield* failure(
                "This sign-in attempt is no longer attached. Reopen sign-in to view its current state.",
              );
            if (input.action === "close") {
              yield* stop(attempt);
              attempts.delete(input.provider);
              return null;
            }
            if (attempt.view.status !== "running")
              return yield* failure("The sign-in command has exited.");
            const owned = attempt;
            yield* Effect.try({
              try: () => {
                if (input.action === "write") owned.process.write(input.data ?? "");
                if (input.action === "resize")
                  owned.process.resize(input.cols ?? 80, input.rows ?? 20);
              },
              catch: () => failure("The sign-in terminal is unavailable."),
            });
            return owned.view;
          }),
        ),
    };
  }),
);
