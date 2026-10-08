import type { ProjectId, ThreadId } from "@glade/contracts/core/baseSchemas";
import type { NativeApi } from "@glade/contracts/ipc/ipc";
import { useComposerDraftStore } from "../composerDraftStore";
import { activeEnvironment } from "./activeEnvironment";
import { LOCAL_ENVIRONMENT, type EnvironmentKey } from "./environmentKey";
import { environmentOfPath, environmentOfProject, environmentOfThread } from "./environmentStores";
import { remoteEnvironment, remoteEnvironments } from "./remoteEnvironments";

type Namespace = keyof NativeApi;
type AnyFunction = (...args: never[]) => unknown;
type Rule = (args: readonly unknown[]) => EnvironmentKey;

function field(args: readonly unknown[], name: string): unknown {
  const input = args[0];
  return typeof input === "object" && input !== null && name in input
    ? (input as Record<string, unknown>)[name]
    : undefined;
}

// A draft chat is not on any server yet; its project decides where it will run.
function ofThread(threadId: unknown): EnvironmentKey {
  if (typeof threadId !== "string") return activeEnvironment();
  const owner = environmentOfThread(threadId as ThreadId);
  if (owner) return owner;
  const draft = useComposerDraftStore.getState().draftThreadsByThreadId[threadId as ThreadId];
  return draft ? ofProject(draft.projectId) : activeEnvironment();
}

function ofProject(projectId: unknown): EnvironmentKey {
  if (typeof projectId !== "string") return activeEnvironment();
  return environmentOfProject(projectId as ProjectId) ?? activeEnvironment();
}

const byThreadInput: Rule = (args) => ofThread(field(args, "threadId"));
const byCwdInput: Rule = (args) =>
  environmentOfPath(field(args, "cwd") ?? field(args, "rootPath") ?? field(args, "path"));
const byThreadOrCwdInput: Rule = (args) =>
  field(args, "threadId") !== undefined ? byThreadInput(args) : byCwdInput(args);
const toActive: Rule = () => activeEnvironment();
const toLocal: Rule = () => LOCAL_ENVIRONMENT;

function dispatchTarget(args: readonly unknown[]): EnvironmentKey {
  const type = field(args, "type");
  // Spaces are the local server's. A new project is created where the caller's API points: through
  // this router that is the local server; SSH hosts get projects through their own API.
  if (typeof type === "string" && (type.startsWith("space.") || type === "project.create")) {
    return LOCAL_ENVIRONMENT;
  }
  const threadId = field(args, "threadId");
  if (typeof threadId === "string" && environmentOfThread(threadId as ThreadId)) {
    return ofThread(threadId);
  }
  if (field(args, "projectId") !== undefined) return ofProject(field(args, "projectId"));
  return threadId !== undefined ? ofThread(threadId) : activeEnvironment();
}

const RULES: { readonly [N in Namespace]: { readonly default: Rule } & Record<string, Rule> } = {
  dialogs: { default: toLocal },
  terminal: { default: byThreadInput },
  projects: {
    default: byCwdInput,
    provisionFromGitHub: toLocal,
    onProvisionProgress: toLocal,
  },
  filesystem: { default: toActive },
  shell: { default: toLocal, openInEditor: (args) => environmentOfPath(args[0]) },
  browser: { default: toLocal },
  computer: { default: toLocal },
  git: { default: byCwdInput, handoffThread: byThreadInput },
  // Settings, keybindings, auth and usage are the local server's; only thread-bound work moves.
  server: {
    default: toLocal,
    readThreadDiagnostics: byThreadInput,
    prewarmVoice: byThreadOrCwdInput,
    transcribeVoice: byThreadOrCwdInput,
  },
  stats: { default: toLocal },
  provider: { default: byThreadOrCwdInput, getComposerCapabilities: toActive },
  orchestration: {
    default: toLocal,
    dispatchCommand: dispatchTarget,
    getThreadDetailSnapshot: byThreadInput,
    getTurnDiff: byThreadInput,
    getFullThreadDiff: byThreadInput,
    prepareHandoff: byThreadInput,
    previewWorkspaceRestore: byThreadInput,
    reconcileProviderDelivery: byThreadInput,
    subscribeThread: byThreadInput,
    unsubscribeThread: byThreadInput,
    replayEvents: (args) => (args[1] === undefined ? LOCAL_ENVIRONMENT : ofThread(args[1])),
    listProviderDeliveryBlockers: (args) =>
      field(args, "threadId") === undefined ? LOCAL_ENVIRONMENT : byThreadInput(args),
  },
};

// Push subscriptions with no thread or path: events from every connected environment are delivered.
const FAN_IN: ReadonlyArray<readonly [Namespace, string]> = [
  ["terminal", "onEvent"],
  ["git", "onActionProgress"],
  ["git", "onWorktreeSetupProgress"],
];

export function environmentApi(key: EnvironmentKey, local: NativeApi): NativeApi {
  if (key === LOCAL_ENVIRONMENT) return local;
  const remote = remoteEnvironment(key)?.api?.api;
  if (!remote)
    throw new Error(`${remoteEnvironment(key)?.host.label ?? "That host"} is not connected.`);
  return remote;
}

function fanIn(local: NativeApi, namespace: Namespace, method: string): AnyFunction {
  return ((listener: unknown) => {
    const apis = [local, ...remoteEnvironments().flatMap((env) => (env.api ? [env.api.api] : []))];
    const stops = apis.map((api) =>
      (api[namespace] as unknown as Record<string, (listener: unknown) => () => void>)[method]!(
        listener,
      ),
    );
    return () => {
      for (const stop of stops) stop();
    };
  }) as AnyFunction;
}

// The NativeApi components use. Each call goes to the environment its thread, project or path belongs
// to; with only the local server connected every call reaches it unchanged.
export function createRoutedNativeApi(local: NativeApi): NativeApi {
  const routed: Record<string, Record<string, AnyFunction>> = {};
  for (const namespace of Object.keys(RULES) as Namespace[]) {
    const rules = RULES[namespace];
    const methods: Record<string, AnyFunction> = {};
    for (const method of Object.keys(local[namespace])) {
      if (FAN_IN.some(([ns, name]) => ns === namespace && name === method)) {
        methods[method] = fanIn(local, namespace, method);
        continue;
      }
      const rule = rules[method] ?? rules.default;
      methods[method] = ((...args: unknown[]) => {
        const target = environmentApi(rule(args), local)[namespace] as unknown as Record<
          string,
          (...callArgs: unknown[]) => unknown
        >;
        return target[method]!(...args);
      }) as AnyFunction;
    }
    routed[namespace] = methods;
  }
  // The routed object mirrors the local API's shape method for method, which TypeScript cannot
  // follow through the generic construction above.
  return routed as unknown as NativeApi;
}
