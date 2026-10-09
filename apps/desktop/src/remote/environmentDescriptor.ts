import { ENVIRONMENT_DESCRIPTOR_PATH } from "@glade/contracts/workspace/environment";

const DESCRIPTOR_TIMEOUT_MS = 5_000;

export interface EnvironmentIdentity {
  readonly environmentId: string;
  readonly label: string;
}

// Which Glade answers at an address, read without signing in. Null when nothing (or not Glade)
// answers in time.
export async function readEnvironmentDescriptor(
  baseUrl: string,
): Promise<EnvironmentIdentity | null> {
  try {
    const response = await fetch(new URL(ENVIRONMENT_DESCRIPTOR_PATH, baseUrl), {
      signal: AbortSignal.timeout(DESCRIPTOR_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { environmentId?: unknown; label?: unknown };
    return typeof body.environmentId === "string" && typeof body.label === "string"
      ? { environmentId: body.environmentId, label: body.label }
      : null;
  } catch {
    return null;
  }
}
