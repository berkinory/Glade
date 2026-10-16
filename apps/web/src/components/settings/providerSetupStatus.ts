import type { ServerProviderStatus } from "@glade/contracts/server/server";

import type { SettingsStatusTone } from "./SettingsStatus";

export function providerSetupStatus(input: {
  readonly status: ServerProviderStatus | undefined;
  readonly reconciled: boolean;
  readonly disabled: boolean;
}): { readonly tone: SettingsStatusTone; readonly label: string } {
  if (input.disabled) return { tone: "off", label: "Disabled" };
  if (!input.reconciled || !input.status) return { tone: "checking", label: "Checking setup" };
  const status = input.status;
  if (!status.available) return { tone: "blocked", label: "Not installed" };
  if (status.authStatus === "unauthenticated") return { tone: "needed", label: "Needs sign-in" };
  if (status.status === "update-required") return { tone: "needed", label: "Update required" };
  if (status.status !== "ready") return { tone: "needed", label: "Needs attention" };
  // A provider that runs without a sign-in, such as OpenCode's free models, names what it offers.
  if (status.authStatus === "unknown") {
    return status.authLabel
      ? { tone: "granted", label: `Ready · ${status.authLabel}` }
      : { tone: "needed", label: "Installed · sign-in not verified" };
  }
  return { tone: "granted", label: "Connected" };
}
