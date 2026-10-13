import type { ProviderKind, ThreadId } from "@glade/contracts/core/baseSchemas";
import type { ProviderSession } from "@glade/contracts/provider/provider";
import type { RuntimeMode } from "@glade/contracts/provider/sessionPolicy";

import { GLADE_MCP_SERVER_NAME } from "../../agentGateway/mcpInjection.ts";
import {
  acquireAgentGatewaySessionLease,
  type AgentGatewaySessionLease,
} from "../../agentGateway/sessionLease.ts";
import type { AgentGatewayCredentialsShape } from "../../agentGateway/Services/AgentGatewayCredentials.ts";
import type { RuntimeEventDraft } from "../core/runtimeEventDraft.ts";
import { mintMspCommandId } from "./mspCommandId.ts";
import { callMsp, MspRequestError, type MspConnection } from "./mspConnection.ts";
import { MspSessionOpened } from "./mspProtocol.ts";
import {
  musePermissionPolicy,
  openMuseHost,
  type MuseHostSpawn,
  type MuseTeardown,
} from "./museHost.ts";
import { openMuseSession, type MuseSession } from "./museSession.ts";

export const MUSE_PROVIDER: ProviderKind = "museCode";

const RESUME_CURSOR_VERSION = 1;
const SESSION_MCP_CAPABILITY = "sessionMcp";

interface MuseResumeCursor {
  readonly schemaVersion: typeof RESUME_CURSOR_VERSION;
  readonly sessionId: string;
}

export function readMuseResumeCursor(value: unknown): MuseResumeCursor | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const record = value as Record<string, unknown>;
  return record.schemaVersion === RESUME_CURSOR_VERSION &&
    typeof record.sessionId === "string" &&
    record.sessionId.length > 0
    ? { schemaVersion: RESUME_CURSOR_VERSION, sessionId: record.sessionId }
    : undefined;
}

// One chat's private `muse serve` host and the MSP session it drives.
export interface MuseThread {
  readonly session: MuseSession;
  readonly lifecycleGeneration: string | undefined;
  readonly gatewayAvailable: boolean;
  record: ProviderSession;
  // The harness policy rides on the first turn of a fresh native session; a resumed session already
  // carries it in its history.
  policyPending: boolean;
  readonly close: () => Promise<void>;
}

function mcpConfig(connection: MspConnection, lease: AgentGatewaySessionLease | undefined) {
  if (!lease || !connection.initialize.grantedCapabilities.includes(SESSION_MCP_CAPABILITY)) {
    return undefined;
  }
  return {
    mcpServers: {
      [GLADE_MCP_SERVER_NAME]: {
        transport: "streamableHttp",
        url: lease.connection.url,
        headers: { Authorization: `Bearer ${lease.connection.bearerToken}` },
      },
    },
  };
}

// Resumes the stored session, or starts a new one when there is none or the host no longer has it.
// A resumed session is moved onto the runtime mode the chat runs in now.
async function openNativeSession(input: {
  readonly connection: MspConnection;
  readonly cwd: string;
  readonly runtimeMode: RuntimeMode;
  readonly modelId: string | undefined;
  readonly resumeSessionId: string | undefined;
  readonly config: ReturnType<typeof mcpConfig>;
}) {
  const { connection } = input;
  const policy = musePermissionPolicy(input.runtimeMode);
  const config = input.config ? { config: input.config } : {};
  if (input.resumeSessionId) {
    const resumed = await callMsp(
      connection,
      "session/resume",
      {
        sessionId: input.resumeSessionId,
        commandId: mintMspCommandId(),
        excludeItems: true,
        ...config,
      },
      MspSessionOpened,
    ).catch((cause: unknown) => {
      if (cause instanceof MspRequestError && cause.kind === "sessionNotFound") return undefined;
      throw cause;
    });
    if (resumed) {
      const { session } = resumed;
      if (session.approvalMode?.mode !== policy.approvalMode) {
        await connection.request("session/setApprovalMode", {
          sessionId: session.sessionId,
          commandId: mintMspCommandId(),
          mode: policy.approvalMode,
        });
      }
      if (session.permissionState?.profileId !== policy.permissionProfile) {
        await connection.request("session/setPermissionProfile", {
          sessionId: session.sessionId,
          commandId: mintMspCommandId(),
          profileId: policy.permissionProfile,
        });
      }
      return { session, resumed: true };
    }
  }
  const started = await callMsp(
    connection,
    "session/start",
    {
      commandId: mintMspCommandId(),
      workspaceRoot: input.cwd,
      approvalMode: policy.approvalMode,
      permissionProfile: policy.permissionProfile,
      ...(input.modelId ? { modelId: input.modelId } : {}),
      ...config,
    },
    MspSessionOpened,
  );
  return { session: started.session, resumed: false };
}

export async function openMuseThread(input: {
  readonly spawn: MuseHostSpawn;
  readonly teardownProcessTree?: MuseTeardown;
  readonly gatewayCredentials: AgentGatewayCredentialsShape | undefined;
  readonly threadId: ThreadId;
  readonly cwd: string;
  readonly runtimeMode: RuntimeMode;
  readonly binaryPath: string | undefined;
  readonly modelId: string | undefined;
  readonly resumeCursor: unknown;
  readonly lifecycleGeneration: string | undefined;
  readonly emit: (draft: RuntimeEventDraft, turnId: string | undefined) => void;
  readonly onExit: (thread: MuseThread, error: Error) => void;
}): Promise<MuseThread> {
  const connection = await openMuseHost({
    spawn: input.spawn,
    cwd: input.cwd,
    binaryPath: input.binaryPath,
    ephemeral: false,
    requestedCapabilities: [SESSION_MCP_CAPABILITY],
    ...(input.teardownProcessTree ? { teardownProcessTree: input.teardownProcessTree } : {}),
  });
  const lease = acquireAgentGatewaySessionLease(
    input.gatewayCredentials,
    input.threadId,
    MUSE_PROVIDER,
    {},
  );
  const release = async () => {
    lease?.release();
    await connection.close().catch(() => undefined);
  };
  const config = mcpConfig(connection, lease);
  const opened = await openNativeSession({
    connection,
    cwd: input.cwd,
    runtimeMode: input.runtimeMode,
    modelId: input.modelId,
    resumeSessionId: readMuseResumeCursor(input.resumeCursor)?.sessionId,
    config,
  }).catch(async (cause: unknown) => {
    await release();
    throw cause;
  });
  const sessionId = opened.session.sessionId;
  const session = openMuseSession({
    connection,
    sessionId,
    modelId: opened.session.modelId ?? input.modelId,
    runtimeMode: input.runtimeMode,
    sink: { emit: input.emit },
  });
  const model = input.modelId ?? opened.session.modelId ?? undefined;
  const now = new Date().toISOString();
  let closing = false;
  const thread: MuseThread = {
    session,
    lifecycleGeneration: input.lifecycleGeneration,
    gatewayAvailable: config !== undefined,
    policyPending: !opened.resumed,
    record: {
      provider: MUSE_PROVIDER,
      status: "ready",
      runtimeMode: input.runtimeMode,
      cwd: input.cwd,
      ...(model ? { model } : {}),
      threadId: input.threadId,
      resumeCursor: { schemaVersion: RESUME_CURSOR_VERSION, sessionId },
      createdAt: now,
      updatedAt: now,
    },
    close: async () => {
      closing = true;
      session.detach();
      await release();
    },
  };
  connection.onExit((error) => {
    if (closing) return;
    session.fail(error.message);
    session.detach();
    lease?.release();
    input.onExit(thread, error);
  });
  return thread;
}
