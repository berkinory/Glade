import { AppPresentation } from "../../agentGateway/Services/AppPresentation";
import { HandoffPreparation } from "../../orchestration/Services/HandoffPreparation";
import { readGitSidebarSummary } from "../../git/gitSidebarSummary";
import { ProviderManagement } from "../../provider/Services/ProviderManagement.ts";
import { sourceControlActions } from "../../git/sourceControlActions.ts";
import { AgentGatewaySessionRegistry } from "../../agentGateway/Services/AgentGatewaySessionRegistry";
import { execFile } from "node:child_process";

import { COMPUTER_WS_METHODS, type ComputerEvent } from "@glade/contracts/computer/computer";
import { ORCHESTRATION_WS_METHODS } from "@glade/contracts/orchestration/rpc";
import { type OrchestrationCommand } from "@glade/contracts/orchestration/commands";
import { type OrchestrationEvent } from "@glade/contracts/orchestration/events";
import {
  type OrchestrationShellStreamEvent,
  type OrchestrationShellStreamItem,
  type OrchestrationThreadDetailSnapshot,
  type OrchestrationThreadStreamItem,
} from "@glade/contracts/orchestration/snapshots";
import { ThreadId } from "@glade/contracts/core/baseSchemas";
import {
  WS_BOOTSTRAP_METHOD,
  WS_BOOTSTRAP_PATH,
  WS_FEATURE_PATH,
  WS_NEGOTIATE_HTTP_PATH,
  WsCompatibilityError,
} from "@glade/contracts/transport/ws/wsCompatibility";
import { WS_METHODS } from "@glade/contracts/transport/ws/ws";
import { WsBootstrapRpcGroup } from "@glade/contracts/transport/ws/bootstrapRpc";
import { WsComputerRpcGroup } from "@glade/contracts/transport/ws/computerRpc";
import { WsFeatureRpcGroup } from "@glade/contracts/transport/ws/rpc";
import { WsRpcError } from "@glade/contracts/transport/ws/rpcErrors";
import {
  type GitActionProgressEvent,
  type GitRemoveWorktreeInput,
  type GitWorktreeSetupProgressEvent,
} from "@glade/contracts/git/git";
import { type GitHubProjectProvisionProgressEvent } from "@glade/contracts/git/githubProjectProvisioning";
import { type ProjectDevServerEvent } from "@glade/contracts/workspace/project";
import {
  type ServerConfigStreamEvent,
  type ServerDiagnosticsResult,
  type ServerLifecycleStreamEvent,
} from "@glade/contracts/server/server";
import { clamp } from "effect/Number";
import { Effect, FileSystem, Layer, Option, Path, Queue, Schema, Scope, Stream } from "effect";
import { Headers, HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";
import { RpcMiddleware, RpcSchema, RpcSerialization, RpcServer } from "effect/unstable/rpc";
import { authErrorResponse, makeEffectAuthRequest } from "../../auth/effectHttp";
import {
  ServerAuth,
  type AuthError,
  type AuthRequest,
  type AuthenticatedSession,
  type ServerAuthShape,
} from "../../auth/Services/ServerAuth";
import { SessionCredentialService } from "../../auth/Services/SessionCredentialService";
import { CheckpointDiffQuery } from "../../checkpointing/Services/CheckpointDiffQuery";
import { ServerConfig, type ServerConfigShape } from "../config";
import { realpathNearestExisting } from "../../platform/filesystem/realpathNearestExisting";
import { workspaceRootsEqual } from "@glade/shared/threads/threadWorkspace";
import { WORKSPACE_FILE_WRITE_CONFLICT_CODE } from "@glade/shared/workspace/workspaceFileWrite";
import {
  isThreadDetailEventFor,
  THREAD_DETAIL_EVENT_TYPES,
} from "@glade/shared/threads/threadDetailEvents";
import {
  DevServerManager,
  findProjectDevServerForLocalServer,
} from "../../workspace/devServers/devServerManager";
import { ComputerService } from "../../computer/Services/ComputerService";
import { makeWsComputerHandlers } from "../../computer/wsComputerHandlers";
import { makeComputerFrameRouteLayer } from "../../computer/computerFrameRoute";
import { ComputerEventInterests } from "../../computer/computerEventInterests";
import { GitCore } from "../../git/Services/GitCore";
import { GitHubCli } from "../../git/Services/GitHubCli";
import { GitManager } from "../../git/Services/GitManager";
import { GitStatusBroadcaster } from "../../git/Services/GitStatusBroadcaster";
import {
  beginGitHandoff,
  completeGitHandoff,
  discardPendingGitHandoff,
  gitHandoffMetadataCommand,
  recordGitHandoffResult,
} from "../../git/gitHandoffOperations";
import { Keybindings } from "../../settings/Services/Keybindings";
import { createLocalPreviewGrant } from "../../attachments/localImageFiles";
import { listLocalServers, stopLocalServer } from "../../workspace/devServers/localServerMonitor";
import {
  archivedWorktreeHasNoOtherOwners,
  discardEmptyManagedWorktreeParent,
  discardManagedWorktreeResidue,
  isManagedWorktreePathCanonical,
  listManagedWorktrees,
  managedWorktreeSnapshotsDir,
  pruneProjectedArchivedManagedWorktrees,
} from "../../git/managedWorktrees";
import {
  attachmentPrincipalForSession,
  CurrentManagedAttachmentPrincipal,
  LOCAL_LOOPBACK_ATTACHMENT_PRINCIPAL,
} from "../../attachments/managedAttachmentPrincipal";
import { Open, resolveAvailableEditors } from "../../workspace/editor/open";
import {
  OrchestrationCommandInvariantError,
  OrchestrationCommandPreviouslyRejectedError,
} from "../../orchestration/Errors";
import { makeDispatchCommandNormalizer } from "../../orchestration/dispatchCommandNormalization";
import { prepareQuitResume } from "../../orchestration/quitResume";
import { makeImportThreadHandler } from "../../orchestration/importThreadRoute";
import { makeProjectImportHandlers } from "../../orchestration/projectImportRoute";
import { makeProjectImportRepository } from "../../persistence/projectImportRepository";
import { OrchestrationEngineService } from "../../orchestration/Services/OrchestrationEngine";
import { ProviderCommandReactor } from "../../orchestration/Services/ProviderCommandReactor";
import { ProjectionStateIncompleteError } from "../../persistence/Errors";
import { ProjectionSnapshotQuery } from "../../orchestration/Services/ProjectionSnapshotQuery";
import { shouldPublishThreadShellForEvent } from "../../orchestration/threadShellEvents";
import { ProviderDiscoveryService } from "../../provider/Services/ProviderDiscoveryService";
import { discoverSkillsCatalog, gladeSkillsDir } from "../../provider/core/skillsCatalog";
import { recoverUnregisteredGitHubCheckout } from "../../project/githubProjectRegistration";
import { ProviderAdapterRegistry } from "../../provider/Services/ProviderAdapterRegistry";
import { getEnabledProviderAdapter } from "../../provider/core/enabledProviderAdapter";
import { ProviderHealth } from "../../provider/Services/ProviderHealth";
import { ProviderService } from "../../provider/Services/ProviderService";
import { consumeCodexResetCreditEffect, listProviderUsage } from "../../provider/usage/index";
import { getProviderUsageSnapshot } from "../../provider/usage/providerUsageSnapshot";
import { ProfileStatsQuery } from "../../diagnostics/Services/ProfileStatsQuery";
import { redactSensitiveProcessArgs } from "../../platform/processArgumentRedaction";
import { ServerEnvironment } from "../../environment/Services/ServerEnvironment";
import { ServerLifecycleEvents } from "../lifecycle/serverLifecycleEvents";
import { ServerRuntimeStartup } from "../runtime/serverRuntimeStartup";
import { ServerSettingsService } from "../../settings/serverSettings";
import { isLoopbackHost } from "../http/startupAccess";
import { TerminalManager } from "../../terminal/Services/Manager";
import { resolveOutOfRootFileReference } from "../../workspace/outOfRootFileReference";
import { watchWorkspaceDirectories } from "../../workspace/workspaceDirectoryChanges";
import { watchWorkspaceFile } from "../../workspace/workspaceFileChanges";
import { WorkspaceEntries } from "../../workspace/Services/WorkspaceEntries";
import {
  WorkspaceFileConflictError,
  WorkspaceFileDeletedError,
  WorkspaceFileSystem,
} from "../../workspace/Services/WorkspaceFileSystem";
import {
  MAX_STREAMS_PER_RPC_CLIENT,
  MAX_THREAD_STREAMS_PER_RPC_CLIENT,
  makeWsStreamAdmission,
} from "./wsStreamAdmission";
import { ThreadDiagnosticsQuery } from "../../diagnostics/Services/ThreadDiagnosticsQuery";
import { makeOwnerThreadDiagnosticReader } from "../../diagnostics/ownerThreadDiagnostics";
import { OrchestrationEventStore } from "../../persistence/Services/OrchestrationEventStore";
import { ProviderRuntimeEventRepository } from "../../persistence/Services/ProviderRuntimeEvents";
import { requireWsOwnerSession } from "./wsOwnerAuthorization";
import { makeWsRequestAdmission } from "./wsRequestAdmission";
import { voiceUploadAdmissionGate } from "../../voice/voiceUploadAdmission";
import {
  provideWsConnectionSession,
  WS_CONNECTION_SESSION_HEADER,
  WsConnectionSessions,
  WsConnectionSessionsLive,
  type WsConnectionSession,
} from "./wsConnectionSessions";
import {
  negotiateWsCompatibility,
  parseWsNegotiateSearchParams,
  validateWsFeatureCompatibility,
} from "./wsCompatibility";
import {
  isTrustedAppOrigin,
  normalizeCorsOrigin,
  requiresWebSocketAuthentication,
  shouldRejectUntrustedRequestOrigin,
} from "../http/trustedOrigins";
import { bufferLiveUiStream, type LiveUiStreamDropReport } from "./wsStreamBackpressure";
import {
  makeCursorSafeSnapshotLiveStream,
  makeResnapshotEscalationTracker,
} from "./wsSnapshotLiveStream";
import { resolveGitHubRepository } from "../../pullRequests/repositoryResolution";
import {
  GitHubProjectProvisioningError,
  makeGitHubProjectProvisioner,
} from "../../project/githubProjectProvisioning";

class RpcRequestError extends Error {
  readonly _tag = "RpcRequestError";
}

const MAX_DIAGNOSTIC_CHILD_PROCESSES = 80;
const MAX_DIAGNOSTIC_ARGS_CHARS = 500;

// Covers subscribe-vs-projection races on freshly created threads; a thread that truly does not
// exist still fails, just this much later.
const THREAD_DETAIL_SNAPSHOT_BOOTSTRAP_TIMEOUT_MS = 5_000;
const THREAD_DETAIL_SNAPSHOT_BOOTSTRAP_POLL_MS = 100;

class WsRequestAdmissionMiddleware extends RpcMiddleware.Service<WsRequestAdmissionMiddleware>()(
  "glade/WsRequestAdmissionMiddleware",
  { error: WsRpcError, requiredForClient: false },
) {}

const AdmittedWsFeatureRpcGroup = WsFeatureRpcGroup.merge(WsComputerRpcGroup).middleware(
  WsRequestAdmissionMiddleware,
);

const wsRequestAdmissionMiddlewareLayer = Layer.effect(
  WsRequestAdmissionMiddleware,
  Effect.gen(function* () {
    const admission = yield* makeWsRequestAdmission;
    const connectionSessions = yield* WsConnectionSessions;
    return ((effect, options) => {
      const scoped = provideWsConnectionSession(
        effect,
        connectionSessions.lookup(Headers.get(options.headers, WS_CONNECTION_SESSION_HEADER)),
      );
      return RpcSchema.isStreamSchema(options.rpc.successSchema)
        ? scoped
        : admission.guard(options.clientId, options.rpc._tag, scoped);
    }) satisfies RpcMiddleware.RpcMiddleware<never, WsRpcError, never>;
  }),
);

const CHAT_WORKSPACE_SUBDIRECTORIES = ["work", "outputs"] as const;

interface ProcessTableRow {
  readonly pid: number;
  readonly ppid: number;
  readonly rssBytes: number;
  readonly virtualSizeBytes: number;
  readonly command: string;
  readonly args: string;
}

function redactAndTruncateProcessArgs(args: string): string {
  const redacted = redactSensitiveProcessArgs(args, {
    truncateSensitiveEnvironmentRemainder: true,
  });
  return redacted.length > MAX_DIAGNOSTIC_ARGS_CHARS
    ? `${redacted.slice(0, Math.max(0, MAX_DIAGNOSTIC_ARGS_CHARS - 15))}... [truncated]`
    : redacted;
}

function parseProcessTable(output: string): ProcessTableRow[] {
  const rows: ProcessTableRow[] = [];
  for (const line of output.split(/\r?\n/)) {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\S+)(?:\s+(.*))?$/);
    if (!match) {
      continue;
    }
    rows.push({
      pid: Number(match[1]),
      ppid: Number(match[2]),
      rssBytes: Number(match[3]) * 1024,
      virtualSizeBytes: Number(match[4]) * 1024,
      command: match[5] ?? "",
      args: redactAndTruncateProcessArgs(match[6] ?? ""),
    });
  }
  return rows;
}

function collectDescendantProcesses(
  rows: readonly ProcessTableRow[],
  rootPid: number,
): ProcessTableRow[] {
  const childrenByParent = new Map<number, ProcessTableRow[]>();
  for (const row of rows) {
    const children = childrenByParent.get(row.ppid) ?? [];
    children.push(row);
    childrenByParent.set(row.ppid, children);
  }

  const descendants: ProcessTableRow[] = [];
  const stack = [...(childrenByParent.get(rootPid) ?? [])];
  while (stack.length > 0) {
    const row = stack.pop()!;
    descendants.push(row);
    stack.push(...(childrenByParent.get(row.pid) ?? []));
  }
  return descendants.toSorted((left, right) => right.rssBytes - left.rssBytes);
}

function readDescendantProcesses(rootPid: number): Promise<ProcessTableRow[]> {
  if (process.platform === "win32") {
    return Promise.resolve([]);
  }
  return new Promise((resolve) => {
    execFile(
      "ps",
      ["-axo", "pid=,ppid=,rss=,vsz=,comm=,args="],
      { maxBuffer: 2 * 1024 * 1024 },
      (_error, stdout) => {
        resolve(collectDescendantProcesses(parseProcessTable(stdout), rootPid));
      },
    );
  });
}

function toWsRpcError(cause: unknown, fallbackMessage: string) {
  if (Schema.is(WsRpcError)(cause)) {
    return cause;
  }
  if (
    Schema.is(OrchestrationCommandInvariantError)(cause) ||
    Schema.is(OrchestrationCommandPreviouslyRejectedError)(cause)
  ) {
    return new WsRpcError({
      message: cause.message,
      code: "ORCHESTRATION_COMMAND_REJECTED",
      retryable: false,
      cause,
    });
  }

  if (Schema.is(ProjectionStateIncompleteError)(cause)) {
    return new WsRpcError({
      message: cause.message,
      code: "ORCHESTRATION_PROJECTION_STATE_INCOMPLETE",
      retryable: false,
      cause,
    });
  }
  return new WsRpcError({
    message: cause instanceof Error && cause.message.length > 0 ? cause.message : fallbackMessage,
    cause,
  });
}

const resnapshotEscalationTracker = makeResnapshotEscalationTracker();

const failLiveUiStreamForSnapshotResync = (report: LiveUiStreamDropReport) =>
  Effect.fail(
    new WsRpcError({
      message: `${report.message}; restarting stream to refresh snapshot.`,
    }),
  );

function isShellRelevantEvent(event: OrchestrationEvent): boolean {
  return (
    event.type === "space.created" ||
    event.type === "space.meta-updated" ||
    event.type === "space.order-updated" ||
    event.type === "space.deleted" ||
    event.type === "project.created" ||
    event.type === "project.meta-updated" ||
    event.type === "project.deleted" ||
    event.type === "thread.deleted" ||
    (event.aggregateKind === "thread" && shouldPublishThreadShellForEvent(event))
  );
}

const makeWsRpcHandlersLayer = () =>
  AdmittedWsFeatureRpcGroup.toLayer(
    Effect.gen(function* () {
      const appPresentation = yield* AppPresentation;
      const checkpointDiffQuery = yield* CheckpointDiffQuery;
      const config = yield* ServerConfig;
      const devServerManager = yield* DevServerManager;
      const fileSystem = yield* FileSystem.FileSystem;
      const git = yield* GitCore;
      const github = yield* GitHubCli;
      const gitManager = yield* GitManager;
      const gitStatusBroadcaster = yield* GitStatusBroadcaster;
      const keybindings = yield* Keybindings;
      const open = yield* Open;
      const orchestrationEngine = yield* OrchestrationEngineService;
      const providerCommandReactor = yield* ProviderCommandReactor;
      const handoffPreparation = yield* HandoffPreparation;
      const path = yield* Path.Path;
      const profileStatsQuery = yield* ProfileStatsQuery;
      const projectionReadModelQuery = yield* ProjectionSnapshotQuery;
      const providerAdapterRegistry = yield* ProviderAdapterRegistry;
      const providerDiscoveryService = yield* ProviderDiscoveryService;
      const providerManagement = yield* ProviderManagement;
      const providerHealth = yield* ProviderHealth;
      const providerService = yield* ProviderService;
      const lifecycleEvents = yield* ServerLifecycleEvents;
      const runtimeStartup = yield* ServerRuntimeStartup;
      const serverEnvironment = yield* ServerEnvironment;
      const serverSettings = yield* ServerSettingsService;
      const terminalManager = yield* TerminalManager;
      const workspaceEntries = yield* WorkspaceEntries;
      const workspaceFileSystem = yield* WorkspaceFileSystem;
      const threadDiagnostics = yield* ThreadDiagnosticsQuery;
      const eventStore = yield* OrchestrationEventStore;
      const providerRuntimeEvents = yield* ProviderRuntimeEventRepository;
      const readOwnerThreadDiagnostics = makeOwnerThreadDiagnosticReader({
        eventStore,
        providerRuntimeEvents,
        requireThreadShell: (threadId) =>
          projectionReadModelQuery.getThreadShellById(ThreadId.makeUnsafe(threadId)).pipe(
            Effect.flatMap(
              Option.match({
                onNone: () => Effect.fail(new RpcRequestError("Thread was not found.")),
                onSome: Effect.succeed,
              }),
            ),
          ),
      });
      const computerService = Option.getOrUndefined(yield* Effect.serviceOption(ComputerService));
      const connectionSessions = yield* WsConnectionSessions;
      const computerInterests = new ComputerEventInterests(connectionSessions.onClose);
      const computerHandlers = makeWsComputerHandlers(
        computerService,
        Option.getOrUndefined(yield* Effect.serviceOption(AgentGatewaySessionRegistry)),
      );
      const githubProjectProvisioner = yield* makeGitHubProjectProvisioner({
        homeDir: config.homeDir,
        fileSystem,
        path,
        git,
        github,
      });
      const streamAdmission = yield* makeWsStreamAdmission({
        recordRejection: (incident) =>
          threadDiagnostics
            .recordOperationalDiagnostic({
              ...(incident.threadId ? { threadId: incident.threadId } : {}),
              source: "server",
              kind: "ws.stream-admission-rejected",
              severity: "warning",
              code: incident.errorCode,
              detail: {
                reason: incident.reason,
                active: incident.active,
                activeThreads: incident.activeThreads,
                streamLimit: MAX_STREAMS_PER_RPC_CLIENT,
                threadLimit: MAX_THREAD_STREAMS_PER_RPC_CLIENT,
              },
              occurredAt: new Date().toISOString(),
            })
            .pipe(
              Effect.catch((error) =>
                Effect.logWarning("Failed to persist streaming RPC rejection diagnostic.", {
                  error: String(error),
                }),
              ),
            ),
      });
      const recordThreadStreamDrop = (threadId: string, report: LiveUiStreamDropReport) =>
        threadDiagnostics
          .recordOperationalDiagnostic({
            threadId,
            source: "server",
            kind: "ws.thread-stream-events-dropped",
            severity: "error",
            code: "THREAD_STREAM_EVENTS_DROPPED",
            detail: {
              label: report.label,
              capacity: report.capacity,
              droppedAtLeast: report.droppedAtLeast,
            },
            occurredAt: new Date().toISOString(),
          })
          .pipe(
            Effect.catch((error) =>
              Effect.logWarning("Failed to persist thread stream drop diagnostic.", {
                error: String(error),
              }),
            ),
            (diagnostic) => Effect.sync(() => Effect.runFork(diagnostic)),
            Effect.andThen(failLiveUiStreamForSnapshotResync(report)),
          );
      const recordThreadResnapshotRequired = (
        threadId: string,
        report: {
          readonly snapshotSequence: number;
          readonly highWaterSequence: number;
          readonly replayCount: number;
          readonly replayLimit: number;
        },
      ) =>
        threadDiagnostics
          .recordOperationalDiagnostic({
            threadId,
            source: "server",
            kind: "ws.thread-stream-resnapshot-required",
            severity: "warning",
            code: "ORCHESTRATION_RESNAPSHOT_REQUIRED",
            detail: {
              snapshotSequence: report.snapshotSequence,
              highWaterSequence: report.highWaterSequence,
              replayCount: report.replayCount,
              replayLimit: report.replayLimit,
            },
            occurredAt: new Date().toISOString(),
          })
          .pipe(
            Effect.catch((error) =>
              Effect.logWarning("Failed to persist thread resnapshot diagnostic.", {
                error: String(error),
              }),
            ),
          );

      // A thread subscription can race the projector: the client subscribes the moment a create/turn RPC
      // resolves, while the detail read model commits asynchronously behind the journal. Waiting here is
      // safe because the cursor-safe stream attaches its live tap before evaluating the snapshot effect,
      // so no event that commits during the wait is lost.
      const loadThreadDetailSnapshotWithBootstrapWait = (threadId: ThreadId) =>
        Effect.gen(function* () {
          const deadline = Date.now() + THREAD_DETAIL_SNAPSHOT_BOOTSTRAP_TIMEOUT_MS;
          while (true) {
            const detail = yield* projectionReadModelQuery.getThreadDetailSnapshotById(threadId);
            if (Option.isSome(detail) || Date.now() >= deadline) {
              return detail;
            }
            yield* Effect.sleep(THREAD_DETAIL_SNAPSHOT_BOOTSTRAP_POLL_MS);
          }
        });

      const canonicalizeProjectWorkspaceRoot = Effect.fnUntraced(function* (
        workspaceRoot: string,
        options: { readonly createIfMissing?: boolean } = {},
      ) {
        const rawWorkspaceRoot = workspaceRoot.trim();
        const expandedWorkspaceRoot =
          rawWorkspaceRoot === "~"
            ? config.homeDir
            : rawWorkspaceRoot.startsWith("~/") || rawWorkspaceRoot.startsWith("~\\")
              ? path.join(config.homeDir, rawWorkspaceRoot.slice(2))
              : rawWorkspaceRoot;
        const normalizedWorkspaceRoot = path.resolve(expandedWorkspaceRoot);
        let workspaceStat = yield* fileSystem
          .stat(normalizedWorkspaceRoot)
          .pipe(Effect.catch(() => Effect.succeed(null)));
        if (!workspaceStat) {
          if (!options.createIfMissing) {
            return yield* new WsRpcError({
              message: `Project directory does not exist: ${normalizedWorkspaceRoot}`,
            });
          }
          yield* fileSystem.makeDirectory(normalizedWorkspaceRoot, { recursive: true }).pipe(
            Effect.mapError(
              (cause) =>
                new WsRpcError({
                  message: `Failed to create project directory: ${normalizedWorkspaceRoot}`,
                  cause,
                }),
            ),
          );
          workspaceStat = yield* fileSystem
            .stat(normalizedWorkspaceRoot)
            .pipe(Effect.catch(() => Effect.succeed(null)));
          if (!workspaceStat) {
            return yield* new WsRpcError({
              message: `Failed to create project directory: ${normalizedWorkspaceRoot}`,
            });
          }
        }
        if (workspaceStat.type !== "Directory") {
          return yield* new WsRpcError({
            message: `Project path is not a directory: ${normalizedWorkspaceRoot}`,
          });
        }
        return yield* realpathNearestExisting(normalizedWorkspaceRoot).pipe(
          Effect.provideService(FileSystem.FileSystem, fileSystem),
          Effect.provideService(Path.Path, path),
        );
      });

      const prepareWorkspaceSubdirectories = Effect.fnUntraced(function* (
        workspaceRoot: string,
        relativeDirnames: readonly string[],
      ) {
        for (const dirname of relativeDirnames) {
          const childPath = path.join(workspaceRoot, dirname);
          yield* fileSystem.makeDirectory(childPath, { recursive: true }).pipe(
            Effect.mapError(
              (cause) =>
                new WsRpcError({
                  message: `Failed to create workspace directory: ${childPath}`,
                  cause,
                }),
            ),
          );
        }
      });
      const prepareChatWorkspaceRoot = (workspaceRoot: string) =>
        prepareWorkspaceSubdirectories(workspaceRoot, CHAT_WORKSPACE_SUBDIRECTORIES);
      // Instruction files are best-effort: they steer agents toward the Outbox layout but must never fail
      // (or retry-loop) the container create that scaffolds the folders.
      const normalizeDispatchCommand = makeDispatchCommandNormalizer<WsRpcError>({
        attachmentsDir: config.attachmentsDir,
        chatWorkspaceRoot: config.chatWorkspaceRoot,
        fileSystem,
        path,
        canonicalizeProjectWorkspaceRoot,
        prepareChatWorkspaceRoot,
      });

      const importThread = makeImportThreadHandler({
        fileSystem,
        orchestrationEngine,
        path,
        platform: process.platform,
        projectionSnapshotQuery: projectionReadModelQuery,
        providerAdapterRegistry,
        providerService,
        serverSettings,
      });
      const projectImports = makeProjectImportHandlers({
        repository: yield* makeProjectImportRepository,
        orchestrationEngine,
        providerService,
        providerAdapterRegistry,
        serverSettings,
      });

      const dispatchOrchestrationCommand = (command: OrchestrationCommand) =>
        Effect.gen(function* () {
          const attachmentPrincipal = yield* CurrentManagedAttachmentPrincipal;
          return yield* runtimeStartup.enqueueCommand(
            orchestrationEngine.dispatch(command, { attachmentPrincipal }),
          );
        });

      const stopLocalServerAndTrackedProjectRun = Effect.fnUntraced(function* (input: {
        pid: number;
        port: number;
      }) {
        const localServer =
          (yield* Effect.promise(() => listLocalServers())).servers.find(
            (server) => server.pid === input.pid && server.ports.includes(input.port),
          ) ?? null;
        const result = yield* Effect.promise(() => stopLocalServer(input, localServer));
        if (localServer?.isStoppable) {
          const devServers = yield* devServerManager.list;
          const trackedServer = findProjectDevServerForLocalServer({
            localServer,
            devServers: devServers.servers,
          });
          if (trackedServer) {
            yield* devServerManager
              .stop({ projectId: trackedServer.projectId })
              .pipe(Effect.catch(() => Effect.void));
          }
        }
        return result;
      });

      const loadServerConfig = Effect.gen(function* () {
        const keybindingsConfig = yield* keybindings.loadConfigState;
        const providerStatuses = yield* providerHealth.getStatuses;
        return {
          cwd: config.cwd,
          homeDir: config.homeDir,
          chatWorkspaceRoot: config.chatWorkspaceRoot,
          worktreesDir: config.worktreesDir,
          keybindingsConfigPath: config.keybindingsConfigPath,
          keybindings: keybindingsConfig.keybindings,
          issues: keybindingsConfig.issues,
          providers: providerStatuses,
          availableEditors: resolveAvailableEditors(),
        };
      });

      const refreshGitStatusAfter = <A, E, R>(cwd: string, effect: Effect.Effect<A, E, R>) =>
        effect.pipe(
          Effect.onExit(() =>
            gitStatusBroadcaster.refreshStatus(cwd).pipe(Effect.catchCause(() => Effect.void)),
          ),
        );

      const refreshGitStatusInBackground = (cwd: string) =>
        gitStatusBroadcaster.refreshStatus(cwd).pipe(
          Effect.catchCause(() => Effect.void),
          Effect.forkDetach,
          Effect.asVoid,
        );

      const validateArchiveWorktreeRemoval = (input: GitRemoveWorktreeInput) =>
        Effect.gen(function* () {
          if (!input.archiveCleanup) return;
          const { threadId, archiveSequence } = input.archiveCleanup;
          const events = yield* Stream.runCollect(
            orchestrationEngine.readThreadEventsThrough(
              threadId,
              Math.max(0, archiveSequence - 1),
              archiveSequence,
              ["thread.archived"],
            ),
          );
          const archiveEvent = [...events].find((event) => event.sequence === archiveSequence);
          const shell = Option.getOrUndefined(
            yield* projectionReadModelQuery.getThreadShellById(threadId),
          );
          if (
            archiveEvent?.type !== "thread.archived" ||
            !archiveEvent.payload.archivedAt ||
            !shell ||
            shell.archivedAt !== archiveEvent.payload.archivedAt ||
            (shell.session !== null && shell.session.status !== "stopped")
          ) {
            return yield* Effect.fail(
              new WsRpcError({ message: "Archive cleanup is no longer safe for this task." }),
            );
          }
          if (
            !(yield* isManagedWorktreePathCanonical({
              worktreesDir: config.worktreesDir,
              worktreePath: input.path,
            }))
          ) {
            return yield* Effect.fail(
              new WsRpcError({ message: "Archive cleanup only removes managed worktrees." }),
            );
          }

          const branchContext = yield* git.readBranchContext(input.path);
          if (!branchContext.isRepo || branchContext.branch === null) {
            return yield* Effect.fail(
              new WsRpcError({ message: "Archive cleanup kept a worktree without a branch." }),
            );
          }
          const owners = yield* projectionReadModelQuery.listManagedWorktreeThreads();
          if (
            !(yield* archivedWorktreeHasNoOtherOwners({
              worktreePath: input.path,
              threadId,
              threads: owners,
            }))
          ) {
            return yield* Effect.fail(
              new WsRpcError({ message: "Another task still refers to this worktree." }),
            );
          }

          yield* terminalManager.closeSessionsOpenedAtOrBefore({
            threadId,
            openedAtOrBefore: archiveEvent.payload.archivedAt,
          });
          const afterTerminalCleanup = Option.getOrUndefined(
            yield* projectionReadModelQuery.getThreadShellById(threadId),
          );
          if (afterTerminalCleanup?.archivedAt !== archiveEvent.payload.archivedAt) {
            return yield* Effect.fail(
              new WsRpcError({ message: "The task was restored during archive cleanup." }),
            );
          }
        });

      const pruneManagedWorktrees = pruneProjectedArchivedManagedWorktrees({
        homeDir: config.homeDir,
        worktreesDir: config.worktreesDir,
        snapshotQuery: projectionReadModelQuery,
        git,
      }).pipe(
        // A retention failure must not present as an empty inventory: fall back to a plain scan so listing
        // callers still see the real worktrees.
        Effect.catchCause((cause) =>
          Effect.logWarning("managed worktree retention failed", {
            cause: String(cause),
          }).pipe(
            Effect.andThen(
              listManagedWorktrees({ worktreesDir: config.worktreesDir, git }).pipe(
                Effect.catchCause((listCause) =>
                  Effect.logWarning("managed worktree inventory scan failed", {
                    cause: String(listCause),
                  }).pipe(Effect.as([])),
                ),
              ),
            ),
          ),
        ),
      );
      const getOrchestrationHighWaterSequence = orchestrationEngine.getEventHighWaterSequence.pipe(
        Effect.mapError((cause) =>
          toWsRpcError(cause, "Failed to capture orchestration high-water sequence"),
        ),
      );

      const toShellStreamEvent = (
        event: OrchestrationEvent,
      ): Effect.Effect<Option.Option<OrchestrationShellStreamEvent>, never> => {
        switch (event.type) {
          case "space.created":
          case "space.meta-updated":
            return projectionReadModelQuery.getSpaceShellById(event.payload.spaceId).pipe(
              Effect.map((space) =>
                Option.map(space, (nextSpace) => ({
                  kind: "space-upserted" as const,
                  sequence: event.sequence,
                  space: nextSpace,
                })),
              ),
              Effect.catch(() => Effect.succeed(Option.none())),
            );
          case "space.order-updated":
            return Effect.succeed(
              Option.some({
                kind: "space-order-updated" as const,
                sequence: event.sequence,
                orderedSpaceIds: event.payload.orderedSpaceIds,
              }),
            );
          case "space.deleted":
            return Effect.succeed(
              Option.some({
                kind: "space-removed" as const,
                sequence: event.sequence,
                spaceId: event.payload.spaceId,
                updatedAt: event.payload.deletedAt,
              }),
            );
          case "project.created":
          case "project.meta-updated":
            return projectionReadModelQuery.getProjectShellById(event.payload.projectId).pipe(
              Effect.map((project) =>
                Option.map(project, (nextProject) => ({
                  kind: "project-upserted" as const,
                  sequence: event.sequence,
                  project: nextProject,
                })),
              ),
              Effect.catch(() => Effect.succeed(Option.none())),
            );
          case "project.deleted":
            return Effect.succeed(
              Option.some({
                kind: "project-removed" as const,
                sequence: event.sequence,
                projectId: event.payload.projectId,
              }),
            );
          case "thread.deleted":
            return Effect.succeed(
              Option.some({
                kind: "thread-removed" as const,
                sequence: event.sequence,
                threadId: event.payload.threadId,
              }),
            );
          default:
            if (event.aggregateKind !== "thread") return Effect.succeed(Option.none());
            return projectionReadModelQuery
              .getThreadShellById(ThreadId.makeUnsafe(String(event.aggregateId)))
              .pipe(
                Effect.map((thread) =>
                  Option.map(thread, (nextThread) => ({
                    kind: "thread-upserted" as const,
                    sequence: event.sequence,
                    thread: nextThread,
                  })),
                ),
                Effect.catch(() => Effect.succeed(Option.none())),
              );
        }
      };

      const rpcEffect = <A, E, R>(effect: Effect.Effect<A, E, R>, fallbackMessage: string) =>
        effect.pipe(Effect.mapError((cause) => toWsRpcError(cause, fallbackMessage)));

      const toProjectProvisionRpcError = (cause: unknown) =>
        Schema.is(GitHubProjectProvisioningError)(cause)
          ? new WsRpcError({
              message: cause.message,
              code: cause.code,
              retryable: cause.retryable,
            })
          : toWsRpcError(cause, "Failed to clone and add the GitHub project");

      const findRegisteredProjectId = (workspaceRoot: string) =>
        orchestrationEngine
          .getReadModel()
          .pipe(
            Effect.map(
              (readModel) =>
                readModel.projects.find(
                  (project) =>
                    project.kind === "project" &&
                    project.deletedAt === null &&
                    workspaceRootsEqual(project.workspaceRoot, workspaceRoot),
                )?.id ?? null,
            ),
          );

      return AdmittedWsFeatureRpcGroup.of({
        [ORCHESTRATION_WS_METHODS.prepareHandoff]: (input) =>
          rpcEffect(
            handoffPreparation.prepare(input).pipe(Effect.asVoid),
            "Failed to prepare handoff context",
          ),
        [ORCHESTRATION_WS_METHODS.dispatchCommand]: (command) =>
          rpcEffect(
            Effect.gen(function* () {
              const { command: normalizedCommand, prepareWorkspaceRoot } =
                yield* normalizeDispatchCommand({ command });
              if (
                normalizedCommand.type === "thread.turn.start" &&
                normalizedCommand.reviewTarget === undefined
              ) {
                yield* handoffPreparation.prepare({
                  threadId: normalizedCommand.threadId,
                  modelSelection: normalizedCommand.modelSelection,
                  providerOptions: normalizedCommand.providerOptions,
                  latestRequest: normalizedCommand.message.text,
                  attachmentCount: normalizedCommand.message.attachments.length,
                });
              }
              if (
                normalizedCommand.type === "thread.turn.interrupt" &&
                (yield* handoffPreparation.cancel(normalizedCommand.threadId))
              ) {
                return {
                  sequence: (yield* projectionReadModelQuery.getSnapshotSequence())
                    .snapshotSequence,
                };
              }
              const result = yield* dispatchOrchestrationCommand(normalizedCommand);
              // Only scaffold managed workspace-root subdirectories (Inbox/Outbox/work/outputs) AFTER the decider
              // has accepted the command. A rejected dispatch (e.g. a cross-kind workspace-root ownership
              // conflict) must never mutate the filesystem.
              if (prepareWorkspaceRoot) {
                yield* prepareWorkspaceRoot;
              }
              if (normalizedCommand.type === "thread.archive") {
                yield* Effect.forkDetach(pruneManagedWorktrees);
              }
              return result;
            }),
            "Failed to dispatch orchestration command",
          ),
        [ORCHESTRATION_WS_METHODS.importThread]: (input) =>
          rpcEffect(importThread(input), "Failed to import thread"),
        [ORCHESTRATION_WS_METHODS.listProjectImports]: (input) =>
          rpcEffect(projectImports.listProjectImports(input), "Failed to find local projects"),
        [ORCHESTRATION_WS_METHODS.readImportedHistory]: (input) =>
          rpcEffect(projectImports.readImportedHistory(input), "Failed to load imported history"),
        [ORCHESTRATION_WS_METHODS.importProject]: (input) =>
          rpcEffect(projectImports.importProject(input), "Failed to import project"),
        [ORCHESTRATION_WS_METHODS.getSnapshot]: () =>
          rpcEffect(
            projectionReadModelQuery.getSnapshot(),
            "Failed to load orchestration snapshot",
          ),
        [ORCHESTRATION_WS_METHODS.getShellSnapshot]: () =>
          rpcEffect(
            projectionReadModelQuery.getShellSnapshot(),
            "Failed to load orchestration shell snapshot",
          ),
        [ORCHESTRATION_WS_METHODS.getThreadDetailSnapshot]: (input) =>
          rpcEffect(
            projectionReadModelQuery
              .getThreadDetailSnapshotById(input.threadId)
              .pipe(Effect.map(Option.getOrNull)),
            "Failed to load orchestration thread detail snapshot",
          ),
        [ORCHESTRATION_WS_METHODS.repairState]: () =>
          rpcEffect(orchestrationEngine.repairState(), "Failed to repair orchestration state"),
        [ORCHESTRATION_WS_METHODS.previewWorkspaceRestore]: (input) =>
          rpcEffect(
            checkpointDiffQuery.previewWorkspaceRestore(input),
            "Failed to preview workspace restore",
          ),
        [ORCHESTRATION_WS_METHODS.getTurnDiff]: (input) =>
          rpcEffect(checkpointDiffQuery.getTurnDiff(input), "Failed to load turn diff"),
        [ORCHESTRATION_WS_METHODS.getFullThreadDiff]: (input) =>
          rpcEffect(
            checkpointDiffQuery.getFullThreadDiff(input),
            "Failed to load full thread diff",
          ),
        [ORCHESTRATION_WS_METHODS.replayEvents]: (input) => {
          const fromSequenceExclusive = clamp(input.fromSequenceExclusive, {
            maximum: Number.MAX_SAFE_INTEGER,
            minimum: 0,
          });
          const replay =
            input.threadId === undefined
              ? orchestrationEngine.readEvents(fromSequenceExclusive)
              : orchestrationEngine.readThreadEvents(
                  input.threadId,
                  fromSequenceExclusive,
                  THREAD_DETAIL_EVENT_TYPES,
                );
          return rpcEffect(
            Stream.runCollect(replay).pipe(Effect.map((events) => Array.from(events))),
            "Failed to replay orchestration events",
          );
        },
        [ORCHESTRATION_WS_METHODS.listProviderDeliveryBlockers]: (input) =>
          rpcEffect(
            providerCommandReactor.listBlockingDeliveries({
              ...(input.threadId === undefined ? {} : { threadId: input.threadId }),
              limit: input.limit ?? 50,
            }),
            "Failed to load provider delivery blockers",
          ),
        [ORCHESTRATION_WS_METHODS.prepareQuitResume]: (input) =>
          rpcEffect(
            runtimeStartup.enqueueCommand(
              prepareQuitResume({
                request: input,
                recordPath: config.quitResumeStatePath,
                getReadModel: orchestrationEngine.getReadModel,
                dispatch: dispatchOrchestrationCommand,
              }),
            ),
            "Failed to prepare chats for resume after quit",
          ),
        [ORCHESTRATION_WS_METHODS.reconcileProviderDelivery]: (input) =>
          rpcEffect(
            Effect.gen(function* () {
              const principal = yield* CurrentManagedAttachmentPrincipal;
              const result = yield* providerCommandReactor.reconcileDelivery({
                eventSequence: input.eventSequence,
                threadId: input.threadId,
                expectedState: input.expectedState,
                outcome: input.outcome,
                reconciledBy: `${principal.ownerKind}:${principal.ownerId}`,
                ...(input.note === undefined ? {} : { note: input.note }),
              });
              if (result === null) {
                return yield* new WsRpcError({
                  message:
                    "Provider delivery no longer matches the requested thread and blocking state.",
                  code: "PROVIDER_DELIVERY_RECONCILIATION_CONFLICT",
                  retryable: false,
                });
              }
              return result;
            }),
            "Failed to reconcile provider delivery",
          ),
        [ORCHESTRATION_WS_METHODS.subscribeShell]: (_, { clientId }) =>
          streamAdmission.guard(
            clientId,
            { key: "orchestration.shell" },
            makeCursorSafeSnapshotLiveStream({
              resnapshotEscalation: {
                streamKey: `${clientId}:orchestration.shell`,
                tracker: resnapshotEscalationTracker,
              },
              subscribeLive: orchestrationEngine.subscribeDomainEvents.pipe(
                Effect.map((stream) =>
                  bufferLiveUiStream(stream.pipe(Stream.filter(isShellRelevantEvent)), {
                    label: "orchestration.shell",
                    onDroppedEvents: failLiveUiStreamForSnapshotResync,
                  }),
                ),
              ),
              snapshot: projectionReadModelQuery
                .getShellSnapshot()
                .pipe(
                  Effect.mapError((cause) => toWsRpcError(cause, "Failed to load shell snapshot")),
                ),
              snapshotSequence: (snapshot) => snapshot.snapshotSequence,
              getHighWaterSequence: getOrchestrationHighWaterSequence,
              replay: (fromSequenceExclusive, throughSequenceInclusive) =>
                orchestrationEngine
                  .readEventsThrough(fromSequenceExclusive, throughSequenceInclusive)
                  .pipe(
                    Stream.filter(isShellRelevantEvent),
                    Stream.mapError((cause) =>
                      toWsRpcError(cause, "Failed to replay shell events"),
                    ),
                  ),
            }).pipe(
              Stream.mapEffect((item) =>
                item.kind === "snapshot"
                  ? Effect.succeed(
                      Option.some<OrchestrationShellStreamItem>({
                        kind: "snapshot",
                        snapshot: item.snapshot,
                      }),
                    )
                  : toShellStreamEvent(item.event),
              ),
              Stream.flatMap((item) =>
                Option.isSome(item) ? Stream.succeed(item.value) : Stream.empty,
              ),
            ),
          ),
        [ORCHESTRATION_WS_METHODS.unsubscribeShell]: () => Effect.void,
        [ORCHESTRATION_WS_METHODS.subscribeThread]: (input, { clientId }) =>
          streamAdmission.guard(
            clientId,
            {
              key: `orchestration.thread:${input.threadId}`,
              threadId: input.threadId,
            },
            makeCursorSafeSnapshotLiveStream({
              resnapshotEscalation: {
                streamKey: `${clientId}:orchestration.thread:${input.threadId}`,
                tracker: resnapshotEscalationTracker,
              },

              resumeFromSequence: input.afterSequence,

              resumeSubjectExists: projectionReadModelQuery.getThreadShellById(input.threadId).pipe(
                Effect.map(Option.isSome),
                Effect.mapError((cause) =>
                  toWsRpcError(cause, "Failed to verify thread before cursor resume"),
                ),
              ),
              onResnapshotRequired: (report) =>
                recordThreadResnapshotRequired(input.threadId, report),
              subscribeLive: orchestrationEngine.subscribeDomainEvents.pipe(
                Effect.map((stream) =>
                  bufferLiveUiStream(
                    stream.pipe(
                      Stream.filter((event) => isThreadDetailEventFor(event, input.threadId)),
                    ),
                    {
                      label: "orchestration.thread-detail",
                      onDroppedEvents: (report) => recordThreadStreamDrop(input.threadId, report),
                    },
                  ),
                ),
              ),
              snapshot: loadThreadDetailSnapshotWithBootstrapWait(input.threadId).pipe(
                Effect.flatMap(
                  Option.match({
                    onNone: () =>
                      projectionReadModelQuery.getSnapshotSequence().pipe(
                        Effect.map(({ snapshotSequence }) => ({
                          detail: Option.none<OrchestrationThreadDetailSnapshot>(),
                          snapshotSequence,
                        })),
                      ),
                    onSome: (detail) =>
                      Effect.succeed({
                        detail: Option.some(detail),
                        snapshotSequence: detail.snapshotSequence,
                      }),
                  }),
                ),
                Effect.mapError((cause) => toWsRpcError(cause, "Failed to load thread snapshot")),
              ),
              snapshotSequence: (snapshot) => snapshot.snapshotSequence,
              getHighWaterSequence: getOrchestrationHighWaterSequence,
              replay: (fromSequenceExclusive, throughSequenceInclusive) =>
                orchestrationEngine
                  .readThreadEventsThrough(
                    input.threadId,
                    fromSequenceExclusive,
                    throughSequenceInclusive,
                    THREAD_DETAIL_EVENT_TYPES,
                  )
                  .pipe(
                    Stream.filter((event) => isThreadDetailEventFor(event, input.threadId)),
                    Stream.mapError((cause) =>
                      toWsRpcError(cause, "Failed to replay thread events"),
                    ),
                  ),
            }).pipe(
              Stream.flatMap((item) => {
                if (item.kind === "event") {
                  return Stream.succeed<OrchestrationThreadStreamItem>({
                    kind: "event",
                    event: item.event,
                  });
                }

                return Option.isSome(item.snapshot.detail)
                  ? Stream.succeed<OrchestrationThreadStreamItem>({
                      kind: "snapshot",
                      snapshot: item.snapshot.detail.value,
                    })
                  : Stream.fail(
                      new WsRpcError({
                        message: `Thread detail snapshot not found for thread ${input.threadId}.`,
                        code: "THREAD_SNAPSHOT_NOT_FOUND",
                        retryable: false,
                      }),
                    );
              }),
            ),
          ),
        [ORCHESTRATION_WS_METHODS.unsubscribeThread]: () => Effect.void,
        [WS_METHODS.subscribeOrchestrationDomainEvents]: (_, { clientId }) =>
          streamAdmission.guard(
            clientId,
            { key: "orchestration.domain-events" },
            bufferLiveUiStream(orchestrationEngine.streamDomainEvents, {
              label: "orchestration.domain-events",
            }),
          ),

        [WS_METHODS.projectsListDirectories]: (input) =>
          rpcEffect(
            workspaceEntries.listDirectories(input),
            "Failed to list workspace directories",
          ),
        [WS_METHODS.projectsSearchEntries]: (input) =>
          rpcEffect(workspaceEntries.search(input), "Failed to search workspace entries"),
        [WS_METHODS.projectsSearchContent]: (input) =>
          rpcEffect(workspaceEntries.searchContent(input), "Failed to search workspace content"),
        [WS_METHODS.projectsPrewarmSearchIndex]: (input) =>
          rpcEffect(
            workspaceEntries.prewarmSearchIndex(input),
            "Failed to prewarm workspace search index",
          ),
        [WS_METHODS.projectsDiscoverScripts]: (input) =>
          rpcEffect(workspaceEntries.discoverScripts(input), "Failed to discover project scripts"),
        [WS_METHODS.projectsSearchLocalEntries]: (input) =>
          rpcEffect(workspaceEntries.searchLocal(input), "Failed to search local entries"),
        [WS_METHODS.projectsReadFile]: (input) =>
          rpcEffect(workspaceFileSystem.readFile(input), "Failed to read workspace file"),
        [WS_METHODS.projectsSubscribeFileChange]: (input, { clientId }) =>
          streamAdmission.guard(
            clientId,
            {
              key: `projects.file-change:${input.cwd}\0${input.relativePath}:${JSON.stringify(input.directoryPaths ?? [])}`,
            },
            (input.directoryPaths
              ? watchWorkspaceDirectories(input)
              : watchWorkspaceFile(input)
            ).pipe(
              Stream.tap(() =>
                input.directoryPaths ? workspaceEntries.invalidate(input.cwd) : Effect.void,
              ),
              Stream.mapError(
                (cause) =>
                  new WsRpcError({
                    message:
                      cause instanceof Error && cause.message.length > 0
                        ? cause.message
                        : "Failed to watch workspace file",
                    code: "PROJECT_FILE_WATCH_FAILED",
                    retryable: false,
                    cause,
                  }),
              ),
            ),
          ),
        [WS_METHODS.projectsResolveWorkspaceFileReferences]: (input) =>
          rpcEffect(
            workspaceEntries.resolveFileReferences(input),
            "Failed to resolve workspace file references",
          ),
        [WS_METHODS.projectsResolveOutOfRootFileReference]: (input) =>
          rpcEffect(
            Effect.promise(async () => ({
              fullPath: await resolveOutOfRootFileReference({
                workspaceRoot: input.cwd,
                relativePath: input.relativePath,
                homeDir: config.homeDir,
              }),
            })),
            "Failed to resolve file reference outside the workspace",
          ),
        [WS_METHODS.projectsCreateLocalFilePreviewGrant]: (input) =>
          rpcEffect(
            Effect.promise(() => createLocalPreviewGrant({ requestedPath: input.path })),
            "Failed to create local file preview grant",
          ),
        [WS_METHODS.projectsWriteFile]: (input) =>
          workspaceFileSystem.writeFile(input).pipe(
            Effect.mapError((cause) =>
              Schema.is(WorkspaceFileConflictError)(cause)
                ? new WsRpcError({
                    message: cause.message,
                    code: WORKSPACE_FILE_WRITE_CONFLICT_CODE,
                    retryable: false,
                  })
                : Schema.is(WorkspaceFileDeletedError)(cause)
                  ? new WsRpcError({
                      message: cause.message,
                      code: "WORKSPACE_FILE_DELETED",
                      retryable: false,
                    })
                  : toWsRpcError(cause, "Failed to write workspace file"),
            ),
          ),
        [WS_METHODS.projectsManageEntry]: (input) =>
          rpcEffect(workspaceFileSystem.manageEntry(input), "Failed to update workspace entry"),
        [WS_METHODS.projectsRunDevServer]: (input) =>
          rpcEffect(devServerManager.run(input), "Failed to start dev server"),
        [WS_METHODS.projectsStopDevServer]: (input) =>
          rpcEffect(devServerManager.stop(input), "Failed to stop dev server"),
        [WS_METHODS.projectsListDevServers]: () =>
          rpcEffect(devServerManager.list, "Failed to list dev servers"),
        [WS_METHODS.subscribeProjectDevServerEvents]: (_, { clientId }) =>
          streamAdmission.guard(
            clientId,
            { key: "projects.dev-servers" },
            Stream.concat(
              Stream.fromEffect(
                devServerManager.list.pipe(
                  Effect.map(
                    (result): ProjectDevServerEvent => ({
                      type: "snapshot",
                      servers: result.servers,
                    }),
                  ),
                ),
              ),
              bufferLiveUiStream(devServerManager.stream, {
                label: "projects.dev-servers",
                onDroppedEvents: failLiveUiStreamForSnapshotResync,
              }),
            ),
          ),
        [WS_METHODS.projectsProvisionFromGitHub]: (input) =>
          bufferLiveUiStream(
            Stream.callback<GitHubProjectProvisionProgressEvent, WsRpcError>((queue) =>
              Effect.gen(function* () {
                const checkout = yield* githubProjectProvisioner.provisionCheckout(input, {
                  publish: (event) => Queue.offer(queue, event).pipe(Effect.asVoid),
                });
                let registrationCommitted = false;
                const registerCheckout = Effect.gen(function* () {
                  yield* Queue.offer(queue, {
                    operationId: input.operationId,
                    kind: "phase",
                    phase: "registering",
                    message: "Adding project to Glade",
                  });

                  const { command: normalizedCommand, prepareWorkspaceRoot } =
                    yield* normalizeDispatchCommand({
                      command: {
                        type: "project.create",
                        commandId: input.commandId,
                        projectId: input.projectId,
                        kind: "project",
                        title: path.basename(checkout.workspaceRoot),
                        workspaceRoot: checkout.workspaceRoot,
                        createWorkspaceRootIfMissing: false,
                        defaultModelSelection: input.defaultModelSelection,
                        spaceId: input.newProjectSpaceId,
                        createdAt: input.createdAt,
                      },
                    });
                  if (normalizedCommand.type !== "project.create") {
                    return yield* Effect.die(
                      new Error("GitHub project provisioning normalized an unexpected command"),
                    );
                  }

                  const existingProjectId = yield* findRegisteredProjectId(
                    normalizedCommand.workspaceRoot,
                  );
                  // Re-adding an existing checkout opens the existing project as-is. In particular, it must not
                  // silently move that project between Spaces; newProjectSpaceId applies only when project.create
                  // runs below.
                  const registration = existingProjectId
                    ? { projectId: existingProjectId, created: false }
                    : yield* dispatchOrchestrationCommand(normalizedCommand).pipe(
                        Effect.map(() => ({ projectId: input.projectId, created: true })),
                        Effect.catch((cause) =>
                          findRegisteredProjectId(normalizedCommand.workspaceRoot).pipe(
                            Effect.flatMap((racedProjectId) =>
                              racedProjectId
                                ? Effect.succeed({ projectId: racedProjectId, created: false })
                                : Effect.fail(cause),
                            ),
                          ),
                        ),
                      );
                  // This assignment is synchronous, so a pending interruption cannot run recovery between a
                  // successful dispatch and recording that fact.
                  registrationCommitted = true;
                  if (registration.created && prepareWorkspaceRoot) {
                    yield* prepareWorkspaceRoot;
                  }

                  return {
                    operationId: input.operationId,
                    repository: checkout.repository,
                    workspaceRoot: normalizedCommand.workspaceRoot,
                    projectId: registration.projectId,
                    checkout: checkout.checkout,
                  } as const;
                }).pipe(
                  Effect.onError(() =>
                    recoverUnregisteredGitHubCheckout({
                      checkout,
                      registrationCommitted,
                      moveWorkspaceRoot: (workspaceRoot, recoveryPath) =>
                        fileSystem.rename(workspaceRoot, recoveryPath),
                    }),
                  ),

                  Effect.uninterruptible,
                );

                const result = yield* registerCheckout;
                yield* Queue.offer(queue, {
                  operationId: input.operationId,
                  kind: "completed",
                  result,
                });
                yield* Queue.end(queue);
              }).pipe(
                Effect.catch((cause) =>
                  Queue.fail(queue, toProjectProvisionRpcError(cause)).pipe(Effect.asVoid),
                ),
              ),
            ),
            { label: "projects.github-provision" },
          ),
        [WS_METHODS.filesystemBrowse]: (input) =>
          rpcEffect(workspaceEntries.browse(input), "Failed to browse filesystem"),
        [WS_METHODS.shellOpenInEditor]: (input) =>
          rpcEffect(open.openInEditor(input), "Failed to open editor"),

        [WS_METHODS.gitGithubRepository]: (input) =>
          rpcEffect(resolveGitHubRepository(git, input.cwd), "Failed to resolve GitHub repository"),
        [WS_METHODS.gitStatus]: (input) =>
          rpcEffect(gitStatusBroadcaster.getStatus(input), "Failed to read git status"),
        [WS_METHODS.gitSidebarSummary]: (input) =>
          rpcEffect(
            readGitSidebarSummary(input, git, github),
            "Failed to read sidebar Git summary",
          ),
        [WS_METHODS.gitSubscribeStatus]: (input, { clientId }) =>
          streamAdmission.guard(
            clientId,
            { key: `git.status:${input.summaryOnly ? "summary" : "full"}:${input.cwd}` },
            gitStatusBroadcaster
              .streamStatus(input)
              .pipe(Stream.mapError((error) => new WsRpcError({ message: error.message }))),
          ),
        [WS_METHODS.gitReadWorkingTreeDiff]: (input) =>
          rpcEffect(gitManager.readWorkingTreeDiff(input), "Failed to read working tree diff"),
        [WS_METHODS.gitReadSourceControlFiles]: (input) =>
          rpcEffect(
            gitManager.readSourceControlFiles(input.cwd, input.query),
            "Failed to read source control files",
          ),
        [WS_METHODS.gitBlameLine]: (input) =>
          rpcEffect(gitManager.blameLine(input), "Failed to read git blame"),
        [WS_METHODS.gitReadFileAtRev]: (input) =>
          rpcEffect(gitManager.readFileAtRev(input), "Failed to read file at revision"),
        [WS_METHODS.gitWorkingTreeDiffStats]: (input) =>
          rpcEffect(
            gitManager.readWorkingTreeDiffStats(input),
            "Failed to read working tree diff stats",
          ),
        [WS_METHODS.gitGenerateCommitMessage]: (input) =>
          rpcEffect(gitManager.generateCommitMessage(input), "Failed to generate commit message"),
        [WS_METHODS.gitSummarizeDiff]: (input) =>
          rpcEffect(gitManager.summarizeDiff(input), "Failed to summarize diff"),
        [WS_METHODS.gitPull]: (input) =>
          rpcEffect(
            refreshGitStatusAfter(
              input.cwd,
              git.withMutation(input.cwd, git.pullCurrentBranch(input.cwd)),
            ),
            "Failed to pull branch",
          ),
        [WS_METHODS.gitRunStackedAction]: (input) =>
          bufferLiveUiStream(
            Stream.callback<GitActionProgressEvent, WsRpcError>((queue) =>
              gitManager
                .runStackedAction(input, {
                  actionId: input.actionId,
                  progressReporter: {
                    publish: (event) => Queue.offer(queue, event).pipe(Effect.asVoid),
                  },
                })
                .pipe(
                  Effect.tap(() => refreshGitStatusInBackground(input.cwd)),
                  Effect.matchCauseEffect({
                    onFailure: (cause) =>
                      Queue.fail(queue, toWsRpcError(cause, "Git action failed")),
                    onSuccess: () => Queue.end(queue).pipe(Effect.asVoid),
                  }),
                ),
            ),
            { label: "git.stacked-action" },
          ),
        [WS_METHODS.gitResolvePullRequest]: (input) =>
          rpcEffect(gitManager.resolvePullRequest(input), "Failed to resolve pull request"),
        [WS_METHODS.gitPreparePullRequestThread]: (input) =>
          rpcEffect(
            refreshGitStatusAfter(input.cwd, gitManager.preparePullRequestThread(input)),
            "Failed to prepare pull request thread",
          ),
        [WS_METHODS.gitListBranches]: (input) =>
          rpcEffect(git.listBranches(input), "Failed to list branches"),
        [WS_METHODS.gitListRecentCommits]: (input) =>
          rpcEffect(git.listRecentCommits(input), "Failed to list recent commits"),
        [WS_METHODS.gitReadCommit]: (input) =>
          rpcEffect(git.readCommit(input), "Failed to read commit"),
        [WS_METHODS.gitCreateWorktree]: (input) =>
          rpcEffect(
            refreshGitStatusAfter(
              input.cwd,
              git.withMutation(input.cwd, git.createWorktree(input)),
            ),
            "Failed to create worktree",
          ),
        [WS_METHODS.gitCreateDetachedWorktree]: (input) =>
          bufferLiveUiStream(
            Stream.callback<GitWorktreeSetupProgressEvent, WsRpcError>((queue) => {
              const progressId = input.progressId ?? null;
              return refreshGitStatusAfter(
                input.cwd,
                git.withMutation(
                  input.cwd,
                  git.createDetachedWorktree(input, {
                    onPhase: (phase) =>
                      Queue.offer(queue, { kind: "phase_started", progressId, phase }).pipe(
                        Effect.asVoid,
                      ),
                  }),
                ),
              ).pipe(
                Effect.matchCauseEffect({
                  onFailure: (cause) =>
                    Queue.fail(queue, toWsRpcError(cause, "Failed to create detached worktree")),
                  onSuccess: (result) =>
                    Queue.offer(queue, { kind: "completed", progressId, result }).pipe(
                      Effect.andThen(Queue.end(queue)),
                      Effect.asVoid,
                    ),
                }),
              );
            }),
            { label: "git.create-detached-worktree" },
          ),
        [WS_METHODS.gitRemoveWorktree]: (input) =>
          rpcEffect(
            refreshGitStatusAfter(
              input.cwd,
              git.withMutation(
                input.cwd,
                validateArchiveWorktreeRemoval(input).pipe(
                  Effect.andThen(
                    git.removeWorktree(
                      input.archiveCleanup
                        ? { ...input, force: false, reclaimTemporaryBranch: false }
                        : input,
                    ),
                  ),

                  Effect.tap(() =>
                    isManagedWorktreePathCanonical({
                      worktreesDir: config.worktreesDir,
                      worktreePath: input.path,
                    }).pipe(
                      Effect.flatMap((managed) =>
                        !managed
                          ? Effect.void
                          : input.archiveCleanup
                            ? discardEmptyManagedWorktreeParent({
                                worktreesDir: config.worktreesDir,
                                worktreePath: input.path,
                              })
                            : discardManagedWorktreeResidue({
                                worktreesDir: config.worktreesDir,
                                snapshotsDir: managedWorktreeSnapshotsDir(config.homeDir),
                                worktreePath: input.path,
                              }),
                      ),
                      Effect.catch(() => Effect.void),
                    ),
                  ),
                ),
              ),
            ),
            "Failed to remove worktree",
          ),
        [WS_METHODS.gitCreateBranch]: (input) =>
          rpcEffect(
            refreshGitStatusAfter(input.cwd, git.withMutation(input.cwd, git.createBranch(input))),
            "Failed to create branch",
          ),
        [WS_METHODS.gitCheckout]: (input) =>
          rpcEffect(
            refreshGitStatusAfter(
              input.cwd,
              git.withMutation(input.cwd, Effect.scoped(git.checkoutBranch(input))),
            ),
            "Failed to checkout branch",
          ),
        [WS_METHODS.gitStashAndCheckout]: (input) =>
          rpcEffect(
            refreshGitStatusAfter(
              input.cwd,
              git.withMutation(input.cwd, Effect.scoped(git.stashAndCheckout(input))),
            ),
            "Failed to stash and checkout",
          ),
        [WS_METHODS.gitStashDrop]: (input) =>
          rpcEffect(
            refreshGitStatusAfter(input.cwd, git.withMutation(input.cwd, git.stashDrop(input))),
            "Failed to drop stash",
          ),
        [WS_METHODS.gitStashInfo]: (input) =>
          rpcEffect(git.stashInfo(input), "Failed to read stash"),
        [WS_METHODS.gitRemoveIndexLock]: (input) =>
          rpcEffect(
            git.withMutation(input.cwd, git.removeIndexLock(input)),
            "Failed to remove Git index lock",
          ),
        [WS_METHODS.gitInit]: (input) =>
          rpcEffect(
            refreshGitStatusAfter(input.cwd, git.withMutation(input.cwd, git.initRepo(input))),
            "Failed to initialize repository",
          ),
        [WS_METHODS.gitCommitStaged]: (input) =>
          rpcEffect(
            git
              .withMutation(
                input.cwd,
                sourceControlActions(git).commitStaged(
                  input.cwd,
                  input.message,
                  input.expectedSnapshot
                    ? { snapshot: input.expectedSnapshot, scope: input.generationScope ?? "staged" }
                    : undefined,
                ),
              )
              .pipe(Effect.onExit(() => refreshGitStatusInBackground(input.cwd))),
            "Failed to commit staged changes",
          ),
        [WS_METHODS.gitFetch]: (input) =>
          rpcEffect(
            git
              .withMutation(input.cwd, sourceControlActions(git).fetch(input.cwd))
              .pipe(Effect.onExit(() => refreshGitStatusInBackground(input.cwd))),
            "Failed to fetch",
          ),
        [WS_METHODS.gitIgnorePaths]: (input) =>
          rpcEffect(
            git
              .withMutation(
                input.cwd,
                sourceControlActions(git).ignorePaths(input.cwd, input.paths),
              )
              .pipe(Effect.onExit(() => refreshGitStatusInBackground(input.cwd))),
            "Failed to update .gitignore",
          ),
        [WS_METHODS.gitRebase]: (input) =>
          rpcEffect(
            git
              .withMutation(input.cwd, sourceControlActions(git).rebase(input))
              .pipe(Effect.onExit(() => refreshGitStatusInBackground(input.cwd))),
            "Failed to rebase",
          ),
        [WS_METHODS.gitCheckUndoCommit]: (input) =>
          rpcEffect(
            git.withMutation(input.cwd, sourceControlActions(git).checkUndoCommit(input.cwd)),
            "Failed to establish undo eligibility",
          ),
        [WS_METHODS.gitUndoCommit]: (input) =>
          rpcEffect(
            git
              .withMutation(
                input.cwd,
                sourceControlActions(git).undoCommit(input.cwd, input.expectedHead),
              )
              .pipe(Effect.onExit(() => refreshGitStatusInBackground(input.cwd))),
            "Failed to undo commit",
          ),
        [WS_METHODS.gitRebaseState]: (input) =>
          rpcEffect(
            sourceControlActions(git).rebaseState(input.cwd),
            "Failed to read rebase state",
          ),
        [WS_METHODS.gitStageFiles]: (input) =>
          rpcEffect(
            git
              .withMutation(input.cwd, git.stageFiles(input.cwd, input.paths, input.allChanges))
              .pipe(
                Effect.tap(() => refreshGitStatusInBackground(input.cwd)),
                Effect.as({ ok: true }),
              ),
            "Failed to stage files",
          ),
        [WS_METHODS.gitRevertUnstagedFile]: (input) =>
          rpcEffect(
            refreshGitStatusAfter(
              input.cwd,
              git.withMutation(input.cwd, git.revertUnstagedFile(input.cwd, input.path)),
            ).pipe(Effect.as({ ok: true })),
            "Failed to revert file",
          ),
        [WS_METHODS.gitUnstageFiles]: (input) =>
          rpcEffect(
            git
              .withMutation(input.cwd, git.unstageFiles(input.cwd, input.paths, input.allChanges))
              .pipe(
                Effect.tap(() => refreshGitStatusInBackground(input.cwd)),
                Effect.as({ ok: true }),
              ),
            "Failed to unstage files",
          ),
        [WS_METHODS.gitHandoffThread]: (input) =>
          rpcEffect(
            Effect.gen(function* () {
              if (input.targetMode === "worktree") {
                return yield* new WsRpcError({
                  message: "Creating a worktree through handoff is no longer supported.",
                });
              }
              const { commandId, threadId, ...gitInput } = input;
              const operation = yield* beginGitHandoff(input);
              if (operation.phase === "pending" || operation.phase === "uncertain") {
                return yield* new WsRpcError({
                  message:
                    operation.phase === "pending"
                      ? "This Git handoff is already running."
                      : "This Git handoff was interrupted before its filesystem result became durable; inspect the repository before retrying.",
                });
              }
              if (operation.phase === "completed") return operation.result;

              const result =
                operation.phase === "git_applied"
                  ? operation.result
                  : yield* refreshGitStatusAfter(
                      input.cwd,
                      gitManager.handoffThread(gitInput).pipe(
                        Effect.catch((error) =>
                          discardPendingGitHandoff(commandId).pipe(
                            Effect.catch(() => Effect.void),
                            Effect.andThen(Effect.fail(error)),
                          ),
                        ),
                      ),
                    ).pipe(Effect.tap((gitResult) => recordGitHandoffResult(commandId, gitResult)));
              yield* dispatchOrchestrationCommand(
                gitHandoffMetadataCommand({ commandId, threadId }, result),
              );
              yield* completeGitHandoff(commandId);
              return result;
            }),
            "Failed to hand off thread",
          ),

        [WS_METHODS.terminalOpen]: (input) =>
          rpcEffect(terminalManager.open(input), "Failed to open terminal"),
        [WS_METHODS.terminalWrite]: (input) =>
          rpcEffect(terminalManager.write(input), "Failed to write terminal"),
        [WS_METHODS.terminalAckOutput]: (input) =>
          rpcEffect(terminalManager.ackOutput(input), "Failed to acknowledge terminal output"),
        [WS_METHODS.terminalResize]: (input) =>
          rpcEffect(terminalManager.resize(input), "Failed to resize terminal"),
        [WS_METHODS.terminalClear]: (input) =>
          rpcEffect(terminalManager.clear(input), "Failed to clear terminal"),
        [WS_METHODS.terminalRestart]: (input) =>
          rpcEffect(terminalManager.restart(input), "Failed to restart terminal"),
        [WS_METHODS.terminalClose]: (input) =>
          rpcEffect(terminalManager.close(input), "Failed to close terminal"),
        [WS_METHODS.subscribeTerminalEvents]: (_, { clientId }) =>
          streamAdmission.guard(
            clientId,
            { key: "terminal.events" },
            Stream.callback((queue) =>
              Effect.gen(function* () {
                const unsubscribe = yield* terminalManager.subscribe((event) => {
                  Effect.runFork(Queue.offer(queue, event).pipe(Effect.asVoid));
                });
                yield* Queue.offer(queue, { type: "ready" as const });
                yield* Effect.addFinalizer(() => Effect.sync(unsubscribe));
              }),
            ),
          ),

        [WS_METHODS.serverGetConfig]: () =>
          rpcEffect(loadServerConfig, "Failed to load server config"),
        [WS_METHODS.serverGetEnvironment]: () =>
          rpcEffect(serverEnvironment.getDescriptor, "Failed to load server environment"),
        [WS_METHODS.serverGetSettings]: () =>
          rpcEffect(serverSettings.getSettingsView, "Failed to load server settings"),
        [WS_METHODS.serverUpdateSettings]: (input) =>
          rpcEffect(serverSettings.updateSettingsView(input), "Failed to update server settings"),
        [WS_METHODS.serverRefreshProviders]: () =>
          rpcEffect(
            providerHealth.refresh.pipe(Effect.map((providers) => ({ providers }))),
            "Failed to refresh providers",
          ),
        [WS_METHODS.serverUpdateProvider]: (input) => providerHealth.updateProvider(input),
        [WS_METHODS.serverListWorktrees]: () =>
          rpcEffect(
            pruneManagedWorktrees.pipe(Effect.map((worktrees) => ({ worktrees }))),
            "Failed to list managed worktrees",
          ),
        [WS_METHODS.serverListLocalServers]: () =>
          rpcEffect(
            Effect.promise(() => listLocalServers()),
            "Failed to list local servers",
          ),
        [WS_METHODS.serverStopLocalServer]: (input) =>
          rpcEffect(stopLocalServerAndTrackedProjectRun(input), "Failed to stop local server"),
        [WS_METHODS.statsGetProfileStats]: (input) =>
          rpcEffect(profileStatsQuery.getProfileStats(input), "Failed to load profile stats"),
        [WS_METHODS.statsGetProfileTokenStats]: (input) =>
          rpcEffect(
            profileStatsQuery.getProfileTokenStats(input),
            "Failed to load profile token stats",
          ),
        [WS_METHODS.serverGetProviderUsageSnapshot]: (input) =>
          rpcEffect(getProviderUsageSnapshot(input), "Failed to load provider usage"),
        [WS_METHODS.serverListProviderUsage]: (input) =>
          rpcEffect(listProviderUsage(input), "Failed to load provider usage"),
        [WS_METHODS.serverConsumeCodexResetCredit]: (input) =>
          rpcEffect(consumeCodexResetCreditEffect(input), "Failed to use Codex reset"),
        [WS_METHODS.serverGetDiagnostics]: () =>
          rpcEffect(
            Effect.gen(function* () {
              const [projection, fullChildProcesses] = yield* Effect.all([
                projectionReadModelQuery.getCounts(),
                Effect.promise(() => readDescendantProcesses(process.pid)),
              ]);
              const memory = process.memoryUsage();
              const diagnostics: ServerDiagnosticsResult = {
                generatedAt: new Date().toISOString(),
                process: {
                  pid: process.pid,
                  uptimeSeconds: Math.max(0, Math.round(process.uptime())),
                  memory: {
                    rssBytes: Math.max(0, Math.round(memory.rss)),
                    heapTotalBytes: Math.max(0, Math.round(memory.heapTotal)),
                    heapUsedBytes: Math.max(0, Math.round(memory.heapUsed)),
                    externalBytes: Math.max(0, Math.round(memory.external)),
                    arrayBuffersBytes: Math.max(0, Math.round(memory.arrayBuffers)),
                  },
                },
                childProcesses: fullChildProcesses.slice(0, MAX_DIAGNOSTIC_CHILD_PROCESSES),
                childProcessTotalCount: fullChildProcesses.length,
                childProcessTotalRssBytes: fullChildProcesses.reduce(
                  (total, processRow) => total + processRow.rssBytes,
                  0,
                ),
                projection,
              };
              return diagnostics;
            }),
            "Failed to load server diagnostics",
          ),
        [WS_METHODS.serverReadThreadDiagnostics]: (input) =>
          requireWsOwnerSession.pipe(
            Effect.andThen(
              rpcEffect(readOwnerThreadDiagnostics(input), "Failed to read thread diagnostics"),
            ),
          ),
        [WS_METHODS.serverPrewarmVoice]: (input) =>
          rpcEffect(
            getEnabledProviderAdapter(input.provider, serverSettings, providerAdapterRegistry).pipe(
              Effect.flatMap((adapter) =>
                Effect.gen(function* () {
                  if (!adapter.prewarmVoice) {
                    return yield* Effect.fail(
                      new RpcRequestError(
                        `Voice transcription is unavailable for provider '${input.provider}'.`,
                      ),
                    );
                  }
                  return yield* adapter.prewarmVoice(input);
                }),
              ),
            ),
            "Voice transcription prewarm failed",
          ),
        [WS_METHODS.serverTranscribeVoice]: (input) =>
          rpcEffect(
            voiceUploadAdmissionGate.run(
              getEnabledProviderAdapter(
                input.provider,
                serverSettings,
                providerAdapterRegistry,
              ).pipe(
                Effect.flatMap((adapter) =>
                  Effect.gen(function* () {
                    if (!adapter.transcribeVoice) {
                      return yield* Effect.fail(
                        new RpcRequestError(
                          `Voice transcription is unavailable for provider '${input.provider}'.`,
                        ),
                      );
                    }
                    return yield* adapter.transcribeVoice(input);
                  }),
                ),
              ),
            ),
            "Voice transcription failed",
          ),
        [WS_METHODS.serverUpsertKeybinding]: (input) =>
          rpcEffect(
            keybindings
              .upsertKeybindingRule(input.rule, input.replacing)
              .pipe(
                Effect.map((keybindingsConfig) => ({ keybindings: keybindingsConfig, issues: [] })),
              ),
            "Failed to update keybinding",
          ),
        [WS_METHODS.subscribeAppPresentation]: (_, { clientId }) =>
          streamAdmission.guard(
            clientId,
            { key: "app.presentation" },
            appPresentation.stream(clientId),
          ),
        [WS_METHODS.acknowledgeAppPresentation]: (input, { clientId }) =>
          rpcEffect(
            appPresentation.acknowledge(clientId, input),
            "Failed to acknowledge app presentation",
          ),
        [WS_METHODS.subscribeServerLifecycle]: (_, { clientId }) =>
          streamAdmission.guard(
            clientId,
            { key: "server.lifecycle" },
            Stream.concat(
              Stream.fromEffect(
                lifecycleEvents.snapshot.pipe(
                  Effect.map((snapshot) =>
                    Array.from(snapshot.events).toSorted(
                      (left, right) => left.sequence - right.sequence,
                    ),
                  ),
                ),
              ).pipe(Stream.flatMap(Stream.fromIterable)),
              bufferLiveUiStream(lifecycleEvents.stream, {
                label: "server.lifecycle",
                onDroppedEvents: failLiveUiStreamForSnapshotResync,
              }),
            ).pipe(
              Stream.map(
                (event): ServerLifecycleStreamEvent =>
                  event.type === "welcome"
                    ? { type: "welcome", payload: event.payload }
                    : event.type === "ready"
                      ? { type: "ready", payload: event.payload }
                      : { type: "maintenance", payload: event.payload },
              ),
            ),
          ),
        [WS_METHODS.subscribeServerConfig]: (_, { clientId }) =>
          streamAdmission.guard(
            clientId,
            { key: "server.config" },
            Stream.concat(
              Stream.fromEffect(
                loadServerConfig.pipe(
                  Effect.map(
                    (config): ServerConfigStreamEvent => ({
                      type: "snapshot" as const,
                      config,
                    }),
                  ),
                ),
              ),
              Stream.merge(
                bufferLiveUiStream(keybindings.streamChanges, {
                  label: "server.keybindings",
                  onDroppedEvents: failLiveUiStreamForSnapshotResync,
                }).pipe(
                  Stream.map((event) => ({
                    type: "configUpdated" as const,
                    payload: { issues: event.issues, providers: [] },
                  })),
                ),
                Stream.merge(
                  bufferLiveUiStream(providerHealth.streamChanges, {
                    label: "server.provider-statuses",
                    onDroppedEvents: failLiveUiStreamForSnapshotResync,
                  }).pipe(
                    Stream.map((providers) => ({
                      type: "providerStatuses" as const,
                      payload: { providers },
                    })),
                  ),
                  bufferLiveUiStream(serverSettings.streamViews, {
                    label: "server.settings",
                    onDroppedEvents: failLiveUiStreamForSnapshotResync,
                  }).pipe(
                    Stream.map((settings) => ({
                      type: "settingsUpdated" as const,
                      payload: { settings },
                    })),
                  ),
                ),
              ),
            ).pipe(Stream.mapError((cause) => toWsRpcError(cause, "Server config stream failed"))),
          ),
        [WS_METHODS.subscribeServerProviderStatuses]: (_, { clientId }) =>
          streamAdmission.guard(
            clientId,
            { key: "server.provider-statuses" },
            Stream.concat(
              Stream.fromEffect(
                providerHealth.getStatuses.pipe(Effect.map((providers) => ({ providers }))),
              ),
              bufferLiveUiStream(providerHealth.streamChanges, {
                label: "server.provider-statuses",
                onDroppedEvents: failLiveUiStreamForSnapshotResync,
              }).pipe(Stream.map((providers) => ({ providers }))),
            ),
          ),
        [WS_METHODS.subscribeServerSettings]: (_, { clientId }) =>
          streamAdmission.guard(
            clientId,
            { key: "server.settings" },
            Stream.concat(
              Stream.fromEffect(
                serverSettings.getSettingsView.pipe(Effect.map((settings) => ({ settings }))),
              ),
              bufferLiveUiStream(serverSettings.streamViews, {
                label: "server.settings",
                onDroppedEvents: failLiveUiStreamForSnapshotResync,
              }).pipe(Stream.map((settings) => ({ settings }))),
            ).pipe(
              Stream.mapError((cause) => toWsRpcError(cause, "Server settings stream failed")),
            ),
          ),

        [WS_METHODS.providerGetComposerCapabilities]: (input) =>
          rpcEffect(
            providerDiscoveryService.getComposerCapabilities(input),
            "Failed to get composer capabilities",
          ),
        [WS_METHODS.providerListCommands]: (input) =>
          rpcEffect(providerDiscoveryService.listCommands(input), "Failed to list commands"),
        [WS_METHODS.providerListSkills]: (input) =>
          rpcEffect(providerDiscoveryService.listSkills(input), "Failed to list skills"),
        [WS_METHODS.providerListSkillsCatalog]: (input) =>
          rpcEffect(
            Effect.tryPromise(() =>
              discoverSkillsCatalog({
                cwd: input.cwd ?? null,
                homeDir: config.homeDir,
                gladeBaseDir: config.baseDir,
                includeDuplicateOrigins: true,
              }),
            ).pipe(
              Effect.map((skills) => ({
                skills,
                gladeSkillsDir: gladeSkillsDir(config.baseDir),
              })),
            ),
            "Failed to list the skills catalog",
          ),
        [WS_METHODS.providerListMcpServers]: (input) =>
          rpcEffect(providerManagement.listMcpServers(input), "Provider management failed"),
        [WS_METHODS.providerManageMcpServer]: (input) =>
          rpcEffect(providerManagement.manageMcpServer(input), "Provider management failed"),
        [WS_METHODS.providerPluginInventory]: (input) =>
          rpcEffect(providerManagement.pluginInventory(input), "Provider management failed"),
        [WS_METHODS.providerManagePlugin]: (input) =>
          rpcEffect(providerManagement.managePlugin(input), "Provider management failed"),
        [WS_METHODS.providerListPlugins]: (input) =>
          rpcEffect(providerDiscoveryService.listPlugins(input), "Failed to list plugins"),
        [WS_METHODS.providerReadPlugin]: (input) =>
          rpcEffect(providerDiscoveryService.readPlugin(input), "Failed to read plugin"),
        [WS_METHODS.providerListModels]: (input) =>
          rpcEffect(providerDiscoveryService.listModels(input), "Failed to list models"),
        [WS_METHODS.providerListAgents]: (input) =>
          rpcEffect(providerDiscoveryService.listAgents(input), "Failed to list agents"),

        ...computerHandlers,
        [COMPUTER_WS_METHODS.getAuditHistory]: (input) =>
          requireWsOwnerSession.pipe(
            Effect.andThen(computerHandlers[COMPUTER_WS_METHODS.getAuditHistory](input)),
          ),
        [COMPUTER_WS_METHODS.getThreadState]: (input, { headers }) =>
          Effect.suspend(() => {
            computerInterests.watch(
              Headers.get(headers, WS_CONNECTION_SESSION_HEADER),
              input.threadId,
            );
            return computerHandlers[COMPUTER_WS_METHODS.getThreadState](input);
          }),
        [COMPUTER_WS_METHODS.subscribeEvents]: (_, { clientId, headers }) =>
          streamAdmission.guard(
            clientId,
            { key: "computer.events" },
            computerService?.supported !== true
              ? Stream.never
              : bufferLiveUiStream(
                  Stream.callback<ComputerEvent>((queue) =>
                    Effect.gen(function* () {
                      const connectionKey = Headers.get(headers, WS_CONNECTION_SESSION_HEADER);
                      const unsubscribe = computerInterests.subscribe(
                        connectionKey,
                        computerService.manager.onEvent.bind(computerService.manager),
                        (event) => {
                          Effect.runFork(Queue.offer(queue, event).pipe(Effect.asVoid));
                        },
                      );

                      yield* Effect.addFinalizer(() => Effect.sync(unsubscribe));
                    }),
                  ),
                  { label: "computer.events" },
                ),
          ),
      });
    }),
  );

const makeWsRpcLayer = () =>
  Layer.merge(makeWsRpcHandlersLayer(), wsRequestAdmissionMiddlewareLayer);

const makeRpcWebSocketHttpEffect = RpcServer.toHttpEffectWebsocket(AdmittedWsFeatureRpcGroup, {
  spanPrefix: "ws.rpc",
  spanAttributes: {
    "rpc.transport": "websocket",
    "rpc.system": "effect-rpc",
  },
}).pipe(Effect.provide(makeWsRpcLayer().pipe(Layer.provideMerge(RpcSerialization.layerJson))));

const makeBootstrapWebSocketHttpEffect = RpcServer.toHttpEffectWebsocket(WsBootstrapRpcGroup, {
  spanPrefix: "ws.bootstrap",
  spanAttributes: {
    "rpc.transport": "websocket",
    "rpc.system": "effect-rpc",
  },
}).pipe(
  Effect.provide(
    WsBootstrapRpcGroup.toLayer(
      Effect.succeed(
        WsBootstrapRpcGroup.of({
          [WS_BOOTSTRAP_METHOD]: negotiateWsCompatibility,
        }),
      ),
    ).pipe(Layer.provideMerge(RpcSerialization.layerJson)),
  ),
);

function trustedWebSocketRequestUrl(
  request: HttpServerRequest.HttpServerRequest,
  config: ServerConfigShape,
): URL | null {
  const url = HttpServerRequest.toURL(request);
  return url &&
    !shouldRejectUntrustedRequestOrigin({
      rawOrigin: request.headers.origin,
      requestOrigin: url.origin,
      config,
    })
    ? url
    : null;
}

export function authenticateRpcWebSocketUpgrade(input: {
  readonly config: Pick<ServerConfigShape, "authToken" | "host" | "publicUrl">;
  readonly legacyToken: string | null;
  readonly request: AuthRequest;
  readonly serverAuth: Pick<ServerAuthShape, "authenticateWebSocketUpgrade">;
}): Effect.Effect<AuthenticatedSession | null, AuthError> {
  if (
    !requiresWebSocketAuthentication(input.config) ||
    (isLoopbackHost(input.config.host) &&
      !input.config.publicUrl &&
      input.legacyToken === input.config.authToken)
  ) {
    return Effect.succeed(null);
  }
  return input.serverAuth.authenticateWebSocketUpgrade(input.request);
}

export function authorizeComputerFrameWebSocketUpgrade(input: {
  readonly config: Pick<ServerConfigShape, "authToken" | "host" | "publicUrl">;
  readonly legacyToken: string | null;
  readonly request: AuthRequest;
  readonly serverAuth: Pick<ServerAuthShape, "authenticateWebSocketUpgrade">;
}): Effect.Effect<boolean> {
  return authenticateRpcWebSocketUpgrade(input).pipe(
    Effect.as(true),
    Effect.orElseSucceed(() => false),
  );
}

export function makeWebsocketRpcRouteLayer<R>(
  rpcWebSocketHttpEffectSource: Effect.Effect<
    Effect.Effect<
      HttpServerResponse.HttpServerResponse,
      never,
      HttpServerRequest.HttpServerRequest | Scope.Scope
    >,
    never,
    R
  >,
) {
  return Layer.effectDiscard(
    Effect.gen(function* () {
      const rpcWebSocketHttpEffect = yield* rpcWebSocketHttpEffectSource;
      const connectionSessions = yield* WsConnectionSessions;
      const router = yield* HttpRouter.HttpRouter;
      // RPC handlers run on fibers forked from the layer-build scope, not from this per-connection fiber,
      // so the authenticated session cannot be provided as a plain service around rpcWebSocketHttpEffect.
      const runWithConnectionSession = (
        request: HttpServerRequest.HttpServerRequest,
        session: WsConnectionSession,
      ) =>
        Effect.gen(function* () {
          const sessionKey = yield* connectionSessions.register(session);
          return yield* rpcWebSocketHttpEffect.pipe(
            Effect.provideService(
              HttpServerRequest.HttpServerRequest,
              request.modify({
                headers: Headers.set(request.headers, WS_CONNECTION_SESSION_HEADER, sessionKey),
              }),
            ),
          );
        });
      yield* router.add(
        "GET",
        WS_FEATURE_PATH,
        Effect.gen(function* () {
          const request = yield* HttpServerRequest.HttpServerRequest;
          const config = yield* ServerConfig;
          const serverAuth = yield* ServerAuth;
          const sessions = yield* SessionCredentialService;
          const url = trustedWebSocketRequestUrl(request, config);
          if (!url) {
            return HttpServerResponse.text("Forbidden", { status: 403 });
          }
          const compatibilityError = validateWsFeatureCompatibility(url.searchParams);
          if (compatibilityError) {
            return HttpServerResponse.jsonUnsafe(compatibilityError, {
              status: 426,
              headers: { "Cache-Control": "no-store" },
            });
          }
          const legacyToken = url.searchParams.get("token");
          const authenticatedSession = yield* authenticateRpcWebSocketUpgrade({
            config,
            legacyToken,
            request: makeEffectAuthRequest(request),
            serverAuth,
          });

          if (!authenticatedSession) {
            return yield* runWithConnectionSession(request, {
              role: "owner",
              attachmentPrincipal: LOCAL_LOOPBACK_ATTACHMENT_PRINCIPAL,
            });
          }

          return yield* sessions.runAuthenticatedConnection(
            authenticatedSession.sessionId,
            runWithConnectionSession(request, {
              role: authenticatedSession.role,
              attachmentPrincipal: attachmentPrincipalForSession(authenticatedSession.sessionId),
            }),
          );
        }).pipe(
          Effect.catchTags({
            AuthError: (error) => Effect.succeed(authErrorResponse(error)),
            SessionCapacityError: (error) =>
              Effect.succeed(
                HttpServerResponse.text(error.message, {
                  status: 429,
                  headers: {
                    "Cache-Control": "no-store",
                    "Retry-After": String(error.retryAfterSeconds),
                  },
                }),
              ),
            SessionCredentialError: (error) =>
              Effect.succeed(HttpServerResponse.text(error.message, { status: 401 })),
          }),
        ),
      );
    }),
  );
}

function makeWsNegotiateHttpRouteLayer() {
  return Layer.effectDiscard(
    Effect.gen(function* () {
      const router = yield* HttpRouter.HttpRouter;
      yield* router.add(
        "GET",
        WS_NEGOTIATE_HTTP_PATH,
        Effect.gen(function* () {
          const request = yield* HttpServerRequest.HttpServerRequest;
          const config = yield* ServerConfig;
          const url = trustedWebSocketRequestUrl(request, config);
          if (!url) {
            // Same no-store discipline as the negotiated responses: an intermediary must never cache a refusal
            // keyed on our behalf.
            return HttpServerResponse.text("Forbidden", {
              status: 403,
              headers: { "Cache-Control": "no-store", Vary: "Origin" },
            });
          }
          // The desktop app fetches cross-origin (glade://app); reflect only origins the WS upgrade itself
          // would trust.
          const origin = normalizeCorsOrigin(request.headers.origin);
          const corsHeaders =
            origin && isTrustedAppOrigin({ origin, requestOrigin: url.origin, config })
              ? { "Access-Control-Allow-Origin": origin, Vary: "Origin" }
              : {};
          const headers = { "Cache-Control": "no-store", ...corsHeaders };
          const input = parseWsNegotiateSearchParams(url.searchParams);
          if (Schema.is(WsCompatibilityError)(input)) {
            return HttpServerResponse.jsonUnsafe(input, { status: 426, headers });
          }
          return yield* negotiateWsCompatibility(input).pipe(
            Effect.map((result) => HttpServerResponse.jsonUnsafe(result, { status: 200, headers })),
            Effect.catch((error) =>
              Effect.succeed(HttpServerResponse.jsonUnsafe(error, { status: 426, headers })),
            ),
          );
        }),
      );
    }),
  );
}

function makeWebsocketBootstrapRouteLayer<R>(
  bootstrapWebSocketHttpEffectSource: Effect.Effect<
    Effect.Effect<
      HttpServerResponse.HttpServerResponse,
      never,
      HttpServerRequest.HttpServerRequest | Scope.Scope
    >,
    never,
    R
  >,
) {
  return Layer.effectDiscard(
    Effect.gen(function* () {
      const bootstrapWebSocketHttpEffect = yield* bootstrapWebSocketHttpEffectSource;
      const router = yield* HttpRouter.HttpRouter;
      yield* router.add(
        "GET",
        WS_BOOTSTRAP_PATH,
        Effect.gen(function* () {
          const request = yield* HttpServerRequest.HttpServerRequest;
          const config = yield* ServerConfig;
          const url = trustedWebSocketRequestUrl(request, config);
          if (!url) {
            return HttpServerResponse.text("Forbidden", { status: 403 });
          }
          return yield* bootstrapWebSocketHttpEffect;
        }),
      );
    }),
  );
}

export const makeWebsocketNegotiationRouteLayer = () =>
  Layer.merge(
    makeWsNegotiateHttpRouteLayer(),
    makeWebsocketBootstrapRouteLayer(makeBootstrapWebSocketHttpEffect),
  );

const computerFrameRouteLayer = makeComputerFrameRouteLayer({
  authorizeUpgrade: (request) =>
    Effect.gen(function* () {
      const config = yield* ServerConfig;
      const serverAuth = yield* ServerAuth;
      const url = trustedWebSocketRequestUrl(request, config);
      if (url === null) return false;
      return yield* authorizeComputerFrameWebSocketUpgrade({
        config,
        legacyToken: url.searchParams.get("token"),
        request: makeEffectAuthRequest(request),
        serverAuth,
      });
    }),
});

export const websocketRpcRouteLayer = Layer.mergeAll(
  computerFrameRouteLayer,
  makeWebsocketNegotiationRouteLayer(),

  makeWebsocketRpcRouteLayer(makeRpcWebSocketHttpEffect).pipe(
    Layer.provide(WsConnectionSessionsLive),
  ),
);
