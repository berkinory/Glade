import type { ContextMenuItem, DesktopContextMenuItem } from "@glade/contracts/ipc/ipc";

const NATIVE_MENU_ICON_POINTS = 16;
const NATIVE_MENU_ICON_SCALE = 2;

const iconDataUrlCache = new Map<string, Promise<string | null>>();

export function isInlineSvgMenuIcon(icon: string): boolean {
  return icon.startsWith("<svg");
}

async function rasterizeMenuIcon(icon: string): Promise<string | null> {
  const image = new Image();
  if (icon.startsWith("/")) {
    image.src = icon;
  } else {
    if (!isInlineSvgMenuIcon(icon)) return null;
    const svg = icon.replaceAll("currentColor", "#000");
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  }
  await image.decode();

  const size = NATIVE_MENU_ICON_POINTS * NATIVE_MENU_ICON_SCALE;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.drawImage(image, 0, 0, size, size);
  return canvas.toDataURL("image/png");
}

function resolveIconDataUrl(icon: string): Promise<string | null> {
  const cached = iconDataUrlCache.get(icon);
  if (cached) return cached;
  const pending = rasterizeMenuIcon(icon)
    .catch(() => null)
    .then((dataUrl) => {
      if (!dataUrl) iconDataUrlCache.delete(icon);
      return dataUrl;
    });
  iconDataUrlCache.set(icon, pending);
  return pending;
}

export function withNativeMenuIcons<T extends string>(
  items: readonly ContextMenuItem<T>[],
): Promise<DesktopContextMenuItem<T>[]> {
  return Promise.all(
    items.map(async (item) => {
      if (!item.icon) return item;
      const iconDataUrl = await resolveIconDataUrl(item.icon);
      return iconDataUrl
        ? { ...item, iconDataUrl, ...(item.icon.startsWith("/") ? { iconTemplate: false } : {}) }
        : item;
    }),
  );
}
