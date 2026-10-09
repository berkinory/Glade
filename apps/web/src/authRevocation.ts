import { AUTH_SIGNED_OUT_PATH } from "./authSignedOut";
import { addWsTransportStateListener } from "./wsTransportEvents";

// A browser whose session was revoked (removed from the machine's device list) would retry its
// connection forever: browsers hide the 401 that ends each WebSocket upgrade. While disconnected,
// ask the server directly; a signed-out answer ends the retries on the signed-out page. An
// unreachable server answers nothing, so an ordinary outage keeps retrying.
export function watchSessionRevocation(): void {
  let connectedOnce = false;
  let checking = false;
  addWsTransportStateListener((state) => {
    if (state === "open") {
      connectedOnce = true;
      return;
    }
    if (!connectedOnce || checking) return;
    checking = true;
    void fetch("/api/auth/session", { credentials: "same-origin" })
      .then((response) => (response.ok ? response.json() : null))
      .then((session: { readonly authenticated?: boolean } | null) => {
        if (session?.authenticated === false) window.location.replace(AUTH_SIGNED_OUT_PATH);
      })
      .catch(() => undefined)
      .finally(() => {
        checking = false;
      });
  });
}
