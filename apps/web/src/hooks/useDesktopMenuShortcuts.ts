import {
  DESKTOP_MENU_SHORTCUT_COMMANDS,
  type DesktopMenuShortcuts,
  type DesktopMenuShortcutCommand,
} from "@glade/contracts/ipc/menuShortcuts";
import type {
  ResolvedKeybindingsConfig,
  KeybindingShortcut,
} from "@glade/contracts/settings/keybindings";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useEffectEvent } from "react";
import {
  resolveKeybindingForCommand,
  resolveShortcutCommand,
  shortcutConflictKey,
} from "~/keybindings";
import { serverConfigQueryOptions } from "~/lib/serverReactQuery";
import { getNavigatorPlatform } from "~/lib/utils";
import { addWsTransportStateListener } from "~/wsTransportEvents";

function resolveDesktopMenuShortcuts(
  keybindings: ResolvedKeybindingsConfig,
  platform: string,
): DesktopMenuShortcuts {
  const shortcuts: Record<DesktopMenuShortcutCommand, KeybindingShortcut | null> = {
    "terminal.new": null,
    "sidebar.toggle": null,
  };
  for (const command of DESKTOP_MENU_SHORTCUT_COMMANDS) {
    const binding = resolveKeybindingForCommand(keybindings, command, { platform });
    if (!binding || binding.whenAst) continue;
    const shortcut = binding.shortcut;
    const conflict = shortcutConflictKey(shortcut, platform);
    if (
      keybindings.some(
        (rule) => rule.whenAst && shortcutConflictKey(rule.shortcut, platform) === conflict,
      )
    )
      continue;
    const isMac = /mac/i.test(platform);
    // The actual dispatcher wins over label fallbacks, including another command's explicit rule.
    if (
      resolveShortcutCommand(
        {
          key: shortcut.key,
          metaKey: shortcut.metaKey || (shortcut.modKey && isMac),
          ctrlKey: shortcut.ctrlKey || (shortcut.modKey && !isMac),
          altKey: shortcut.altKey,
          shiftKey: shortcut.shiftKey,
        },
        keybindings,
        { platform },
      ) !== command
    )
      continue;
    shortcuts[command] = shortcut;
  }
  return shortcuts;
}

export function useDesktopMenuShortcuts(): void {
  const config = useQuery(serverConfigQueryOptions());
  const report = useEffectEvent(() => {
    const bridge = window.desktopBridge;
    if (!bridge) return Promise.resolve();
    return bridge.setMenuShortcuts({
      shortcuts: resolveDesktopMenuShortcuts(
        config.data?.keybindings ?? [],
        getNavigatorPlatform(),
      ),
      capturing: document.activeElement?.hasAttribute("data-keybinding-capture") === true,
    });
  });

  useEffect(() => {
    let disposed = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let failures = 0;
    const sync = () => {
      clearTimeout(retry);
      void report()
        .then(() => {
          failures = 0;
        })
        .catch((error: unknown) => {
          if (disposed) return;
          if (++failures <= 3) retry = setTimeout(sync, 1000);
          else console.error("Unable to synchronize desktop menu shortcuts", error);
        });
    };
    const focusChanged = () =>
      queueMicrotask(() => {
        if (!disposed) sync();
      });
    let capturing = document.activeElement?.hasAttribute("data-keybinding-capture") === true;
    const observer = new MutationObserver(() => {
      const next = document.activeElement?.hasAttribute("data-keybinding-capture") === true;
      if (capturing === next) return;
      capturing = next;
      sync();
    });
    // Removing a focused recorder does not reliably emit focusout in Chromium.
    observer.observe(document.body, { childList: true, subtree: true });
    sync();
    document.addEventListener("focusin", focusChanged);
    document.addEventListener("focusout", focusChanged);
    const unsubscribe = addWsTransportStateListener((state) => {
      if (state === "open") sync();
    });
    return () => {
      disposed = true;
      observer.disconnect();
      clearTimeout(retry);
      unsubscribe();
      document.removeEventListener("focusin", focusChanged);
      document.removeEventListener("focusout", focusChanged);
    };
  }, [config.data, config.dataUpdatedAt]);
}
