import {
  DESKTOP_SSH_REMOTE_EDITORS,
  type DesktopSshRemoteEditor,
} from "@glade/contracts/ipc/sshHosts";
import type { EditorId } from "@glade/contracts/settings/editor";
import { LOCAL_ENVIRONMENT, type EnvironmentKey } from "./environmentKey";
import { remoteEnvironment } from "./remoteEnvironments";

function isRemoteEditor(editor: EditorId): editor is DesktopSshRemoteEditor {
  return (DESKTOP_SSH_REMOTE_EDITORS as readonly string[]).includes(editor);
}

// Every installed editor opens local folders. On an SSH host only editors with a Remote-SSH
// extension can, and only when the user's ssh config alone reaches the host (no port or key file
// saved just in Glade).
export function editorsForEnvironment(
  environmentKey: EnvironmentKey,
  installed: ReadonlyArray<EditorId>,
): ReadonlyArray<EditorId> {
  if (environmentKey === LOCAL_ENVIRONMENT) return installed;
  const host = remoteEnvironment(environmentKey)?.host;
  if (!host || host.port !== null || host.identityFile !== null) return [];
  return installed.filter(isRemoteEditor);
}

export async function openInRemoteEditor(
  environmentKey: EnvironmentKey,
  path: string,
  editor: EditorId,
): Promise<void> {
  const host = remoteEnvironment(environmentKey)?.host;
  if (!host || !isRemoteEditor(editor)) return;
  await window.desktopBridge?.sshHosts?.openInEditor({ hostId: host.id, path, editor });
}
