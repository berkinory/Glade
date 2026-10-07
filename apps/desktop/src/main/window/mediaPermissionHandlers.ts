import { session, systemPreferences, type BrowserWindow } from "electron";
import { isClipboardWritePermission } from "./clipboardPermissions";
import { isTrustedMediaPermissionRequest } from "./mediaPermissions";
export function configureMediaPermissions(getMainWindow: () => BrowserWindow | null): void {
  const trustedMainRenderer = () => {
    const renderer = getMainWindow()?.webContents ?? null;
    return renderer && !renderer.isDestroyed() ? renderer : null;
  };
  const permissionTargets = [
    {
      targetSession: session.defaultSession,
      trustedRequester: trustedMainRenderer,
    },
  ];

  for (const { targetSession, trustedRequester } of permissionTargets) {
    if (!targetSession) continue;

    targetSession.setPermissionCheckHandler((webContents, permission, origin, details) => {
      if (isClipboardWritePermission(webContents, permission, details, origin)) return true;
      if (
        permission !== "media" ||
        !isTrustedMediaPermissionRequest(webContents, trustedRequester(), details, origin)
      ) {
        return false;
      }

      return process.platform === "darwin"
        ? systemPreferences.getMediaAccessStatus("microphone") === "granted"
        : true;
    });

    targetSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
      if (isClipboardWritePermission(webContents, permission, details)) {
        callback(true);
        return;
      }
      if (
        permission !== "media" ||
        !isTrustedMediaPermissionRequest(webContents, trustedRequester(), details)
      ) {
        callback(false);
        return;
      }

      if (process.platform === "darwin") {
        const status = systemPreferences.getMediaAccessStatus("microphone");
        if (status === "granted") {
          callback(true);
          return;
        }

        void systemPreferences
          .askForMediaAccess("microphone")
          .then(callback, () => callback(false));
        return;
      }

      callback(true);
    });
  }
}
