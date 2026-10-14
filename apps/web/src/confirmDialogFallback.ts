import { UI_MOTION } from "@glade/shared/uiMotion";
import { UI_MOTION_BACKDROP_CLASS, UI_MOTION_DIALOG_CLASS } from "./lib/uiMotion";
import { ELEVATED_HOVER_SURFACE_CLASS_NAME } from "./surfaceStyles";

export function showConfirmDialogFallback(message: string): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const lines = message.split("\n");
    const title = lines[0] ?? message;
    const description = lines.slice(1).join("\n").trim();

    const backdrop = document.createElement("div");
    backdrop.className = `fixed inset-0 z-50 bg-black/50 ${UI_MOTION_BACKDROP_CLASS}`;
    backdrop.dataset.startingStyle = "";

    backdrop.dataset.slot = "alert-dialog-backdrop";

    const viewport = document.createElement("div");
    viewport.className = "fixed inset-0 z-50 flex items-center justify-center p-4";
    viewport.dataset.slot = "alert-dialog-viewport";

    const popup = document.createElement("div");
    popup.dataset.slot = "alert-dialog-popup";
    popup.setAttribute("role", "alertdialog");
    popup.setAttribute("aria-modal", "true");
    popup.className = `flex w-full max-w-[22rem] flex-col rounded-xl border border-[color:var(--color-border-light)] bg-[var(--composer-surface)] text-[var(--color-text-foreground)] shadow-xl ${UI_MOTION_DIALOG_CLASS}`;
    popup.dataset.startingStyle = "";

    const header = document.createElement("div");
    header.className = "flex flex-col gap-1.5 px-4 py-3.5 text-center sm:text-left";

    const titleEl = document.createElement("h2");
    titleEl.className = "font-heading font-semibold text-base leading-snug";
    titleEl.textContent = title;
    header.appendChild(titleEl);

    if (description) {
      const descEl = document.createElement("p");
      descEl.className = "text-muted-foreground text-ui-lg leading-5";
      descEl.textContent = description;
      header.appendChild(descEl);
    }

    popup.appendChild(header);

    const footer = document.createElement("div");
    footer.className = "flex flex-col-reverse gap-2 px-4 py-3 sm:flex-row sm:justify-end";

    let settled = false;
    let openingFrame = 0;
    function cleanup(result: boolean) {
      if (settled) return;
      settled = true;
      cancelAnimationFrame(openingFrame);
      document.removeEventListener("keydown", onKeyDown);
      backdrop.dataset.endingStyle = "";
      popup.dataset.endingStyle = "";
      backdrop.style.pointerEvents = "none";
      viewport.style.pointerEvents = "none";
      const duration = matchMedia("(prefers-reduced-motion: reduce)").matches
        ? 0
        : UI_MOTION.defaultMs;
      setTimeout(() => {
        backdrop.remove();
        viewport.remove();
      }, duration);
      resolve(result);
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        cleanup(false);
      } else if (e.key === "Enter") {
        e.preventDefault();
        cleanup(true);
      }
    }

    document.addEventListener("keydown", onKeyDown);
    backdrop.addEventListener("mousedown", () => cleanup(false));

    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.textContent = "Cancel";
    cancelBtn.className =
      "inline-flex h-8 min-w-20 cursor-pointer items-center justify-center whitespace-nowrap rounded-md border border-[color:var(--color-border)] bg-[var(--color-background-elevated-primary-opaque)] px-3 text-ui-lg font-medium text-[var(--color-text-foreground)] outline-none focus-visible:ring-1 focus-visible:ring-ring/60 " +
      ELEVATED_HOVER_SURFACE_CLASS_NAME;
    cancelBtn.addEventListener("click", () => cleanup(false));

    const confirmBtn = document.createElement("button");
    confirmBtn.type = "button";
    confirmBtn.textContent = "Confirm";
    confirmBtn.className =
      "inline-flex h-8 min-w-20 cursor-pointer items-center justify-center whitespace-nowrap rounded-md border border-foreground bg-foreground px-3 text-ui-lg font-medium text-background outline-none transition-[scale,background-color] duration-(--ui-motion-default-duration) hover:scale-[1.02] hover:bg-foreground/92 focus-visible:ring-1 focus-visible:ring-ring/60";

    confirmBtn.addEventListener("click", () => cleanup(true));

    footer.appendChild(cancelBtn);
    footer.appendChild(confirmBtn);
    popup.appendChild(footer);
    viewport.appendChild(popup);

    document.body.appendChild(backdrop);
    document.body.appendChild(viewport);
    void popup.offsetWidth;
    openingFrame = requestAnimationFrame(() => {
      delete backdrop.dataset.startingStyle;
      delete popup.dataset.startingStyle;
    });

    requestAnimationFrame(() => {
      if (!settled) confirmBtn.focus();
    });
  });
}
