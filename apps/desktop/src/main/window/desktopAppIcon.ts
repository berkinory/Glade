const APP_ICON_RESOURCE_NAMES = {
  darwin: "dock-icon.png",
  linux: "icon.png",
  win32: "icon.ico",
} as const;

export function desktopAppIconResourceName(platform: keyof typeof APP_ICON_RESOURCE_NAMES): string {
  return APP_ICON_RESOURCE_NAMES[platform];
}
