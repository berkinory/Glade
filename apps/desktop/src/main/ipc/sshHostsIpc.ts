import {
  DESKTOP_SSH_REMOTE_EDITORS,
  DesktopSshHostInput,
  type DesktopSshRemoteEditor,
} from "@glade/contracts/ipc/sshHosts";
import { Option, Schema } from "effect";
import { ipcMain, shell } from "electron";
import type { RemoteConnections } from "../../remote/remoteConnections";
import type { SshAskpass } from "../../remote/sshAskpass";
import { discoverSshHosts } from "../../remote/sshHostDiscovery";
import type { SshHostsStore } from "../../remote/sshHostsStore";
import { DESKTOP_IPC_CHANNELS } from "./ipcChannels";

const decodeHostInput = Schema.decodeUnknownOption(DesktopSshHostInput);

function requireHostId(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 64) {
    throw new Error("Invalid SSH host id.");
  }
  return value;
}

function requireConnectInput(value: unknown): {
  hostId: string;
  interactive: boolean;
  repair: boolean;
} {
  const fields =
    typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
  if (
    typeof fields.interactive !== "boolean" ||
    (fields.repair !== undefined && typeof fields.repair !== "boolean")
  ) {
    throw new Error("Invalid SSH connect request.");
  }
  return {
    hostId: requireHostId(fields.hostId),
    interactive: fields.interactive,
    repair: fields.repair === true,
  };
}

function requirePromptAnswer(value: unknown): { promptId: string; answer: string | null } {
  const fields =
    typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
  const { promptId, answer } = fields;
  if (typeof promptId !== "string" || promptId.length > 64) throw new Error("Invalid SSH prompt.");
  if (
    answer !== null &&
    (typeof answer !== "string" || answer.length > 4096 || answer.includes("\n"))
  ) {
    throw new Error("Invalid SSH prompt answer.");
  }
  return { promptId, answer };
}

// The editor resolves the host through the user's ssh config, which knows nothing about a port or
// key file saved only in Glade; such hosts are not offered to editors.
function remoteEditorUrl(store: SshHostsStore, value: unknown): string {
  const fields =
    typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
  const host = store.get(requireHostId(fields.hostId));
  const editor = fields.editor as DesktopSshRemoteEditor;
  if (!host || host.port !== null || host.identityFile !== null) {
    throw new Error("This host cannot be opened in an editor.");
  }
  if (!DESKTOP_SSH_REMOTE_EDITORS.includes(editor)) throw new Error("Unsupported editor.");
  if (
    typeof fields.path !== "string" ||
    !fields.path.startsWith("/") ||
    fields.path.length > 4096
  ) {
    throw new Error("Invalid path on the host.");
  }
  const path = fields.path.split("/").map(encodeURIComponent).join("/");
  return `${editor}://vscode-remote/ssh-remote+${encodeURIComponent(host.destination)}${path}`;
}

export function registerSshHostsIpc({
  store,
  connections,
  askpass,
}: {
  readonly store: SshHostsStore;
  readonly connections: RemoteConnections;
  readonly askpass: SshAskpass;
}): void {
  const handlers: ReadonlyArray<readonly [string, (payload: unknown) => unknown]> = [
    [DESKTOP_IPC_CHANNELS.sshHostsList, () => store.list()],
    [DESKTOP_IPC_CHANNELS.sshHostsDiscover, () => discoverSshHosts()],
    [DESKTOP_IPC_CHANNELS.sshHostsGetStates, () => connections.states()],
    [
      DESKTOP_IPC_CHANNELS.sshHostsSave,
      (payload) => {
        const input = decodeHostInput(payload, { onExcessProperty: "error" });
        if (Option.isNone(input)) throw new Error("Invalid SSH host.");
        return store.save(input.value);
      },
    ],
    [
      DESKTOP_IPC_CHANNELS.sshHostsRemove,
      (payload) => {
        const hostId = requireHostId(payload);
        connections.forget(hostId);
        store.remove(hostId);
      },
    ],
    [
      DESKTOP_IPC_CHANNELS.sshHostsConnect,
      (payload) => {
        const { hostId, interactive, repair } = requireConnectInput(payload);
        return connections.connect(hostId, { interactive, repair });
      },
    ],
    [DESKTOP_IPC_CHANNELS.sshHostsGetPrompts, () => askpass.prompts()],
    [
      DESKTOP_IPC_CHANNELS.sshHostsOpenInEditor,
      (payload) => shell.openExternal(remoteEditorUrl(store, payload)),
    ],
    [
      DESKTOP_IPC_CHANNELS.sshHostsAnswerPrompt,
      (payload) => {
        const { promptId, answer } = requirePromptAnswer(payload);
        askpass.answer(promptId, answer);
      },
    ],
  ];
  for (const [channel, handle] of handlers) {
    ipcMain.removeHandler(channel);
    ipcMain.handle(channel, (_event, payload: unknown) => handle(payload));
  }
}
