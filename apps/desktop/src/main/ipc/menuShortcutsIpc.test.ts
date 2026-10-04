import type { IpcMainInvokeEvent, WebContents } from "electron";
import { describe, expect, it, vi } from "vitest";
import { DESKTOP_IPC_CHANNELS } from "./ipcChannels";
import { registerMenuShortcutsIpc } from "./menuShortcutsIpc";

describe("menu shortcut IPC authority", () => {
  it("admits bounded known commands only from the shell's current main frame", () => {
    const handle = vi.fn();
    const apply = vi.fn();
    const mainFrame = {};
    let destroyed = false;
    // Electron objects are represented only at the IPC boundary; the registered handler is real.
    const owner = { mainFrame, isDestroyed: () => destroyed } as WebContents;
    registerMenuShortcutsIpc({ handle, removeHandler: vi.fn() }, () => owner, apply);
    expect(handle.mock.calls[0]?.[0]).toBe(DESKTOP_IPC_CHANNELS.setMenuShortcuts);
    const handler = handle.mock.calls[0]![1];
    const trusted = { sender: owner, senderFrame: mainFrame } as IpcMainInvokeEvent;
    const shortcuts = { "terminal.new": null, "sidebar.toggle": null, "browser.toggle": null };
    const state = { shortcuts, capturing: true };
    for (const sender of [
      { ...trusted, sender: {} },
      { ...trusted, senderFrame: {} },
      { ...trusted, senderFrame: null },
    ]) {
      expect(() => handler(sender, state)).toThrow("Untrusted");
    }
    for (const payload of [
      { ...state, capturing: "yes" },
      { ...state, shortcuts: { ...shortcuts, "chat.new": null } },
      { ...state, shortcuts: { ...shortcuts, "sidebar.toggle": "Cmd+B" } },
      {
        ...state,
        shortcuts: {
          ...shortcuts,
          "sidebar.toggle": {
            key: "b".repeat(65),
            modKey: true,
            metaKey: false,
            ctrlKey: false,
            altKey: false,
            shiftKey: false,
          },
        },
      },
    ]) {
      expect(() => handler(trusted, payload)).toThrow("Invalid");
    }
    expect(apply).not.toHaveBeenCalled();
    handler(trusted, state);
    expect(apply).toHaveBeenCalledExactlyOnceWith(state);
    destroyed = true;
    expect(() => handler(trusted, state)).toThrow("Untrusted");
    expect(apply).toHaveBeenCalledTimes(1);
  });
});
