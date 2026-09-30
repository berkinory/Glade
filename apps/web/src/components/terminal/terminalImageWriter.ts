import type { Terminal } from "@xterm/xterm";

export interface TerminalOutputWriter {
  write: (data: string, onParsed?: () => void) => void;
}

class ImageSequenceDetector {
  private state: "text" | "escape" | "dcs" | "osc" = "text";
  private dcsImageHeader = true;
  private oscPrefix = "";
  private oscEscape = false;

  get pendingImageHeader(): boolean {
    return (
      this.state === "escape" ||
      (this.state === "dcs" && this.dcsImageHeader) ||
      (this.state === "osc" && "1337;File=".startsWith(this.oscPrefix))
    );
  }

  scan(data: string): boolean {
    for (const character of data) {
      if (this.state === "osc") {
        if (
          character === "\x07" ||
          character === "\x9c" ||
          (this.oscEscape && character === "\\")
        ) {
          this.state = "text";
          this.oscEscape = false;
          continue;
        }
        this.oscEscape = character === "\x1b";
        if (this.oscPrefix.length < 10) {
          this.oscPrefix += character;
          if (this.oscPrefix === "1337;File=") return true;
        }
        continue;
      }
      if (character === "\x1b") {
        this.state = "escape";
        continue;
      }
      if (character === "\x90" || (this.state === "escape" && character === "P")) {
        this.state = "dcs";
        this.dcsImageHeader = true;
        continue;
      }
      if (character === "\x9d" || (this.state === "escape" && character === "]")) {
        this.state = "osc";
        this.oscPrefix = "";
        continue;
      }
      if (this.state === "dcs") {
        if (character >= "@" && character <= "~") {
          this.state = "text";
          if (character === "q" && this.dcsImageHeader) return true;
        } else if (character < " " || character > "?") this.state = "text";
        else if (character < "0" || character > ";") this.dcsImageHeader = false;
      } else this.state = "text";
    }
    return false;
  }
}

export function createTerminalImageWriter(
  terminal: Terminal,
): TerminalOutputWriter & { dispose: () => void } {
  const detector = new ImageSequenceDetector();
  let state: "text" | "loading" | "ready" | "disposed" = "text";
  const isDisposed = () => state === "disposed";
  const waiting: Array<{ data: string; onParsed?: () => void }> = [];
  const flush = () => {
    for (const write of waiting.splice(0)) {
      if (state === "disposed") write.onParsed?.();
      else terminal.write(write.data, write.onParsed);
    }
  };
  const write: TerminalOutputWriter["write"] = (data, onParsed) => {
    if (state === "disposed") {
      onParsed?.();
      return;
    }
    if (state === "ready") {
      terminal.write(data, onParsed);
      return;
    }
    const imageHeader = state === "text" && detector.scan(data);
    if (state === "text" && !imageHeader && !detector.pendingImageHeader && waiting.length === 0) {
      terminal.write(data, onParsed);
      return;
    }
    waiting.push({ data, ...(onParsed ? { onParsed } : {}) });
    if (state === "loading") return;
    if (!imageHeader) {
      if (!detector.pendingImageHeader) flush();
      return;
    }
    state = "loading";
    // Hold split image headers until handlers exist. OSC selects its handler before File=
    // identifies the image; releasing an earlier prefix would silently lose the first image.
    void import("@xterm/addon-image")
      .then(async ({ ImageAddon }) => {
        if (isDisposed()) return;
        const addon = new ImageAddon({ storageLimit: 16 });
        terminal.loadAddon(addon);
        // xterm registers handlers before its asynchronous WASM decoder is ready.
        await addon.ready;
        if (isDisposed()) return;
        state = "ready";
        flush();
      })
      .catch((error: unknown) => {
        if (isDisposed()) return;
        console.warn("Terminal image support failed to load", error);
        state = "ready";
        flush();
      });
  };
  return {
    write,
    dispose: () => {
      state = "disposed";
      flush();
    },
  };
}
