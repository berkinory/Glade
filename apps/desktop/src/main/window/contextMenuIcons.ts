import { nativeImage } from "electron";
import { type DesktopRuntime } from "../desktopRuntimeTypes";

export function createContextMenuIcons(
  desktopRuntime: Pick<
    DesktopRuntime,
    | "destructiveMenuIconCache"
    | "CONTEXT_MENU_ICON_MAX_DATA_URL_LENGTH"
    | "CONTEXT_MENU_ICON_DATA_URL_PREFIX"
  >,
) {
  function getDestructiveMenuIcon(): Electron.NativeImage | undefined {
    if (process.platform !== "darwin") return undefined;
    if (desktopRuntime.destructiveMenuIconCache !== undefined) {
      return desktopRuntime.destructiveMenuIconCache ?? undefined;
    }
    try {
      const icon = nativeImage.createFromNamedImage("trash").resize({
        width: 14,
        height: 14,
      });
      if (icon.isEmpty()) {
        desktopRuntime.destructiveMenuIconCache = null;
        return undefined;
      }
      icon.setTemplateImage(true);
      desktopRuntime.destructiveMenuIconCache = icon;
      return icon;
    } catch {
      desktopRuntime.destructiveMenuIconCache = null;
      return undefined;
    }
  }

  function createContextMenuIcon(
    dataUrl: unknown,
    template = true,
  ): Electron.NativeImage | undefined {
    if (
      process.platform !== "darwin" ||
      typeof dataUrl !== "string" ||
      dataUrl.length > desktopRuntime.CONTEXT_MENU_ICON_MAX_DATA_URL_LENGTH ||
      !dataUrl.startsWith(desktopRuntime.CONTEXT_MENU_ICON_DATA_URL_PREFIX)
    ) {
      return undefined;
    }
    const icon = nativeImage.createFromBuffer(
      Buffer.from(dataUrl.slice(desktopRuntime.CONTEXT_MENU_ICON_DATA_URL_PREFIX.length), "base64"),
      { scaleFactor: 2 },
    );
    if (icon.isEmpty()) return undefined;
    icon.setTemplateImage(template);
    return icon;
  }
  return { getDestructiveMenuIcon, createContextMenuIcon };
}
