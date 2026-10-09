import { renderStaticScreen } from "./staticScreen";

export const AUTH_SIGNED_OUT_PATH = "/signed-out";

function renderSignedOutScreen(): void {
  renderStaticScreen({
    documentTitle: "Signed out",
    title: "This device was removed",
    message:
      "It can no longer use Glade on that machine. To use it again, pair it from Settings → Remote access on the machine running Glade.",
  });
}

export function bootstrapSignedOutScreen(): boolean {
  if (window.location.pathname !== AUTH_SIGNED_OUT_PATH) return false;
  renderSignedOutScreen();
  return true;
}
