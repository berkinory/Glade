// Masking requires both the global flag and an explicit per-app opt-in. Environment-only opt-in
// prevents persisted state from silently arming a shield on upgrade.

function envFlagEnabled(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "on" || normalized === "yes";
}

export function cuaMaskedActivationEnabled(): boolean {
  return envFlagEnabled(process.env.GLADE_CUA_MASKED_ACTIVATION);
}

export function cuaMaskedActivationOptIn(): ReadonlySet<string> {
  const raw = process.env.GLADE_CUA_MASKED_APPS ?? "";
  return new Set(
    raw
      .split(/[\s,;]+/)
      .map((entry) => entry.trim().toLowerCase())
      .filter((entry) => entry.length > 0),
  );
}

export function maskedActivationOptedIn(
  optIn: ReadonlySet<string>,
  bundleId: string | undefined,
): boolean {
  return bundleId !== undefined && optIn.has(bundleId.trim().toLowerCase());
}
