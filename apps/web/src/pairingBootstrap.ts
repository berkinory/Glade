import { renderStaticScreen } from "./staticScreen";

const PAIRING_PATH = "/pair";

interface PairingLocation {
  readonly pathname: string;
  readonly search: string;
  readonly hash: string;
  replace(url: string): void;
}

interface PairingHistory {
  replaceState(data: unknown, unused: string, url?: string | URL | null): void;
}

interface PairingBootstrapDependencies {
  readonly location: PairingLocation;
  readonly history: PairingHistory;
  readonly fetch: typeof globalThis.fetch;
  readonly renderFailure: () => void;
}

export type PairingBootstrapResult = "not-pairing" | "redirecting" | "failed";

function renderPairingFailure(): void {
  renderStaticScreen({
    documentTitle: "Pairing failed",
    title: "This link didn't work",
    message:
      "It may have expired or already been used. On the machine running Glade, open Settings → Remote access and pair this device again.",
    alert: true,
  });
}

export async function bootstrapPairingSession(
  dependencies: PairingBootstrapDependencies = {
    location: window.location,
    history: window.history,
    // Called as a method of this object, so the bare global would throw "Illegal invocation".
    fetch: (input, init) => globalThis.fetch(input, init),
    renderFailure: renderPairingFailure,
  },
): Promise<PairingBootstrapResult> {
  if (dependencies.location.pathname !== PAIRING_PATH) {
    return "not-pairing";
  }

  const credential = new URLSearchParams(dependencies.location.hash.slice(1)).get("token");
  dependencies.history.replaceState(
    null,
    "",
    `${dependencies.location.pathname}${dependencies.location.search}`,
  );

  if (!credential) {
    dependencies.renderFailure();
    return "failed";
  }

  try {
    const response = await dependencies.fetch("/api/auth/bootstrap", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ credential }),
    });
    if (!response.ok) {
      dependencies.renderFailure();
      return "failed";
    }
  } catch {
    dependencies.renderFailure();
    return "failed";
  }

  dependencies.location.replace("/");
  return "redirecting";
}
