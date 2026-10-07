import type { BrowserPickTheme } from "@glade/contracts/browser/browserView";
import type { CdpSession } from "./cdpSession";

export interface OverlayBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

type OverlayCall =
  | { readonly op: "show"; readonly box: OverlayBox; readonly label: string; readonly size: string }
  | { readonly op: "hide" }
  | { readonly op: "confirm"; readonly box: OverlayBox | null }
  | { readonly op: "remove" };

// Runs inside the page in an isolated world, so page scripts cannot reach these functions, and the
// closed shadow root keeps page CSS out. Styles go through CSSOM and motion through
// element.animate, which a page CSP does not block the way it blocks an inline <style>.
function installPickOverlay(theme: BrowserPickTheme): void {
  const ease = "cubic-bezier(0.2, 0, 0, 1)";
  const moving = theme.reducedMotion
    ? "opacity 80ms linear"
    : `transform 140ms ${ease}, width 140ms ${ease}, height 140ms ${ease}, opacity 120ms ${ease}`;
  const host = document.createElement("div");
  host.style.cssText =
    "all: initial !important; position: fixed !important; inset: 0 !important; pointer-events: none !important; z-index: 2147483647 !important;";
  const root = host.attachShadow({ mode: "closed" });
  const box = document.createElement("div");
  const label = document.createElement("div");
  const base = "position: fixed; left: 0; top: 0; box-sizing: border-box; opacity: 0;";
  box.style.cssText = `${base} border: 1.5px solid ${theme.accent}; border-radius: 6px; background: color-mix(in srgb, ${theme.accent} 12%, transparent); transition: ${moving};`;
  label.style.cssText = `${base} max-width: 320px; padding: 3px 8px; border-radius: 8px; border: 1px solid ${theme.border}; background: ${theme.surface}; color: ${theme.foreground}; font: 12px/1.4 ${theme.fontFamily || "system-ui, sans-serif"}; white-space: nowrap; display: flex; gap: 8px; box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18); transition: ${moving};`;
  const name = document.createElement("span");
  const size = document.createElement("span");
  name.style.cssText = "min-width: 0; overflow: hidden; text-overflow: ellipsis;";
  size.style.cssText = "flex: none; opacity: 0.6; font-variant-numeric: tabular-nums;";
  label.append(name, size);
  root.append(box, label);
  document.documentElement.append(host);

  const place = (target: OverlayBox, text: string, dimensions: string) => {
    box.style.transform = `translate(${target.x}px, ${target.y}px)`;
    box.style.width = `${target.width}px`;
    box.style.height = `${target.height}px`;
    name.textContent = text;
    size.textContent = dimensions;
    const labelHeight = label.offsetHeight || 24;
    const above = target.y - labelHeight - 6;
    const top =
      above >= 4 ? above : Math.min(target.y + target.height + 6, innerHeight - labelHeight - 4);
    const left = Math.max(4, Math.min(target.x, innerWidth - label.offsetWidth - 4));
    label.style.transform = `translate(${left}px, ${top}px)`;
    box.style.opacity = "1";
    label.style.opacity = "1";
  };
  const fadeOutAndRemove = (delay: number) => {
    box.style.opacity = "0";
    label.style.opacity = "0";
    setTimeout(() => host.remove(), delay);
  };

  Object.defineProperty(globalThis, "__gladePickOverlay", {
    configurable: true,
    value: (call: OverlayCall) => {
      if (call.op === "show") place(call.box, call.label, call.size);
      else if (call.op === "hide") {
        // Instant, so the element screenshot that follows never contains the overlay.
        box.style.transition = "none";
        label.style.transition = "none";
        box.style.opacity = "0";
        label.style.opacity = "0";
        void box.offsetWidth;
        box.style.transition = moving;
        label.style.transition = moving;
      } else if (call.op === "confirm") {
        if (!call.box || theme.reducedMotion) {
          fadeOutAndRemove(150);
          return;
        }
        place(call.box, "Added to chat", "");
        box.animate(
          [
            { boxShadow: `0 0 0 0 color-mix(in srgb, ${theme.accent} 45%, transparent)` },
            { boxShadow: "0 0 0 10px transparent" },
          ],
          { duration: 420, easing: "ease-out" },
        );
        setTimeout(() => fadeOutAndRemove(160), 520);
      } else fadeOutAndRemove(theme.reducedMotion ? 0 : 140);
    },
  });
}

// The picker's highlight and label, drawn in the page's main frame. Calls are best effort: a
// navigation mid-pick destroys the world, and the pick itself works without the overlay.
export class PickOverlay {
  private contextId: number | null = null;

  private constructor(private readonly cdp: CdpSession) {}

  static async install(cdp: CdpSession, theme: BrowserPickTheme): Promise<PickOverlay> {
    const overlay = new PickOverlay(cdp);
    try {
      const { frameTree } = await cdp.send<{ frameTree: { frame: { id: string } } }>(
        "Page.getFrameTree",
      );
      const { executionContextId } = await cdp.send<{ executionContextId: number }>(
        "Page.createIsolatedWorld",
        { frameId: frameTree.frame.id, worldName: "glade-pick-overlay" },
      );
      await cdp.send("Runtime.evaluate", {
        contextId: executionContextId,
        expression: `(${installPickOverlay.toString()})(${JSON.stringify(theme)})`,
      });
      overlay.contextId = executionContextId;
    } catch {
      overlay.contextId = null;
    }
    return overlay;
  }

  show(box: OverlayBox, label: string): Promise<void> {
    const size = `${Math.round(box.width)} × ${Math.round(box.height)}`;
    return this.call({ op: "show", box, label, size });
  }

  // The overlay's isolated world in the main frame; null when it could not be installed.
  world(): number | null {
    return this.contextId;
  }

  hide(): Promise<void> {
    return this.call({ op: "hide" });
  }

  confirm(box: OverlayBox | null): Promise<void> {
    return this.call({ op: "confirm", box });
  }

  remove(): Promise<void> {
    return this.call({ op: "remove" });
  }

  private async call(call: OverlayCall): Promise<void> {
    if (this.contextId === null) return;
    await this.cdp
      .send("Runtime.evaluate", {
        contextId: this.contextId,
        expression: `globalThis.__gladePickOverlay?.(${JSON.stringify(call)})`,
      })
      .catch(() => {
        this.contextId = null;
      });
  }
}
