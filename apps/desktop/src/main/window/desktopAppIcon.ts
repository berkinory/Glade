import { DesktopAppIcon } from "@glade/contracts/ipc/ipc";
import { Schema } from "effect";

type DesktopPlatform = "darwin" | "linux" | "win32";

interface DesktopAppIconResourceInput {
  readonly icon: DesktopAppIcon;
  readonly platform: DesktopPlatform;
}

const APP_ICON_RESOURCE_NAMES = {
  darwin: {
    default: "dock-icon.png",
    dark: "dock-icon-dark.png",
  },
  linux: {
    default: "icon.png",
    dark: "icon-dark.png",
  },
  win32: {
    default: "icon.ico",
    dark: "icon-dark.ico",
  },
} as const;

export const isDesktopAppIcon = Schema.is(DesktopAppIcon);

export function shouldUpdateDesktopAppIcon(
  currentIcon: DesktopAppIcon,
  requestedIcon: DesktopAppIcon,
): boolean {
  return currentIcon !== requestedIcon;
}

export function desktopAppIconResourceName(input: DesktopAppIconResourceInput): string {
  return APP_ICON_RESOURCE_NAMES[input.platform][input.icon];
}

export function createExclusiveApplyQueue<T>(
  apply: (value: T) => void | Promise<void>,
): (value: T) => Promise<void> {
  let current: { value: T; promise: Promise<void> } | null = null;

  return (value: T): Promise<void> => {
    if (current && Object.is(current.value, value)) return current.promise;

    const previous = current?.promise ?? Promise.resolve();
    const run = previous.then(
      () => apply(value),
      () => apply(value),
    );
    const wrapped = run.finally(() => {
      if (current?.promise === wrapped) current = null;
    });
    current = { value, promise: wrapped };
    return wrapped;
  };
}
