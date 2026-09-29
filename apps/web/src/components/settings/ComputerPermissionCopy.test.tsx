import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ComputerPermissionGuide } from "./ComputerPermissionGuide";

vi.mock("~/components/ui/toast", () => ({ toastManager: { add: vi.fn() } }));

function renderGuide(pane: Parameters<typeof ComputerPermissionGuide>[0]["pane"]) {
  return renderToStaticMarkup(
    <ComputerPermissionGuide
      pane={pane}
      appDisplayName="Glade"
      waiting
      onOpenSettings={() => undefined}
      onRestart={() => undefined}
    />,
  );
}

describe("ComputerPermission permission copy", () => {
  it("walks through System Settings without claiming a live dialog", () => {
    for (const pane of ["accessibility", "input-monitoring", "screen-recording"] as const) {
      const markup = renderGuide(pane);
      expect(markup).toContain("Watching for the change");
      expect(markup).toContain("Restart");
      expect(markup).not.toContain("macOS is asking");
      expect(markup).not.toContain("live dialog");
      expect(markup).not.toContain("dialog is open");
    }
  });
});
