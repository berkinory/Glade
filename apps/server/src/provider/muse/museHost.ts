import type { ChildProcessWithoutNullStreams } from "node:child_process";

import type { RuntimeMode } from "@glade/contracts/provider/sessionPolicy";

import type { teardownChildProcessTree } from "../../platform/supervisedProcessTeardown.ts";
import { mintMspCommandId } from "./mspCommandId.ts";
import { callMsp, openMspConnection, type MspConnection } from "./mspConnection.ts";
import { MspSessionOpened } from "./mspProtocol.ts";

export type MuseHostSpawn = (input: {
  readonly cwd: string;
  readonly binaryPath: string | undefined;
  readonly args: ReadonlyArray<string>;
}) => ChildProcessWithoutNullStreams;

export type MuseTeardown = Parameters<typeof teardownChildProcessTree>[1];

// A chat's host keeps durable session logs so the chat can resume, and loads the workspace's own
// skills and rules the way Muse does in the user's terminal.
const SESSION_HOST_ARGS = ["serve", "--trust-workspace"];
// A private host for one request: nothing is stored, and it can neither run commands nor write.
const EPHEMERAL_HOST_ARGS = ["serve", "--no-session-log", "--disable-shell", "--disable-write"];

// Supervised asks a person before restricted actions (`:ask-me` routes approvals to the user, not
// Muse's AI reviewer). Full Access runs unsandboxed without prompts.
export function musePermissionPolicy(runtimeMode: RuntimeMode) {
  return runtimeMode === "full-access"
    ? { approvalMode: "allowAll", permissionProfile: ":unrestricted" }
    : { approvalMode: "promptUnmatched", permissionProfile: ":ask-me" };
}

export function openMuseHost(input: {
  readonly spawn: MuseHostSpawn;
  readonly cwd: string;
  readonly binaryPath: string | undefined;
  readonly ephemeral: boolean;
  readonly requestedCapabilities?: ReadonlyArray<string>;
  readonly teardownProcessTree?: MuseTeardown;
}): Promise<MspConnection> {
  return openMspConnection({
    child: input.spawn({
      cwd: input.cwd,
      binaryPath: input.binaryPath,
      args: input.ephemeral ? EPHEMERAL_HOST_ARGS : SESSION_HOST_ARGS,
    }),
    experimentalApi: true,
    requestedCapabilities: input.requestedCapabilities ?? [],
    ...(input.teardownProcessTree ? { teardownProcessTree: input.teardownProcessTree } : {}),
  });
}

// A tool-free session on a private host: every tool call is refused without asking.
export async function startRequestSession(
  connection: MspConnection,
  cwd: string,
  modelId: string | undefined,
): Promise<string> {
  const opened = await callMsp(
    connection,
    "session/start",
    {
      commandId: mintMspCommandId(),
      workspaceRoot: cwd,
      approvalMode: "denyUnmatched",
      ...(modelId ? { modelId } : {}),
    },
    MspSessionOpened,
  );
  return opened.session.sessionId;
}

// A private host that leaves nothing behind; the process tree is torn down, including when `signal`
// aborts.
export async function withEphemeralMuseHost<A>(input: {
  readonly spawn: MuseHostSpawn;
  readonly cwd: string;
  readonly binaryPath: string | undefined;
  readonly signal: AbortSignal;
  readonly teardownProcessTree?: MuseTeardown;
  readonly use: (connection: MspConnection) => Promise<A>;
}): Promise<A> {
  const connection = await openMuseHost({ ...input, ephemeral: true });
  const abort = () => void connection.close();
  input.signal.addEventListener("abort", abort, { once: true });
  try {
    input.signal.throwIfAborted();
    return await input.use(connection);
  } finally {
    input.signal.removeEventListener("abort", abort);
    await connection.close();
  }
}
