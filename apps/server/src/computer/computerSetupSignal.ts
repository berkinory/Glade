import type {
  ComputerAvailability,
  ComputerBuildSignature,
  ComputerPermission,
} from "@glade/contracts/computer/computer";
import {
  computerGrantsBlockControl,
  listComputerPermissions,
} from "@glade/shared/computer/computerGrants";
import { GLADE_DESKTOP_BUNDLE_ID_ENV } from "@glade/shared/platform/desktopIdentity";

import { ComputerBackendError } from "./ComputerBackend.ts";

// Read here rather than passed down from the backend because it is a property of the *process*, not
// of a tool call or a helper: the desktop shell sets it on the environment it starts the server in,
// and a server started any other way — a bare `bun run`, a remote host — genuinely has no
// responsible app.
function responsibleDesktopBundleId(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string | undefined {
  const value = env[GLADE_DESKTOP_BUNDLE_ID_ENV]?.trim();
  return value ? value : undefined;
}

export interface ComputerSetupSignal {
  readonly missing: readonly ComputerPermission[];
  // A missing Screen Recording grant removes screenshots, not input authority. Do not tell agents to
  // stop successful work for that degraded capability.
  readonly blocking: boolean;
  // Carried alongside the grants because an ad-hoc build has a second explanation for a missing one —
  // the grant is pinned to a cdhash a rebuild replaced — and the card cannot offer it without this.
  readonly buildSignature?: ComputerBuildSignature;
  // Carried with the signal rather than resolved by the card because only the server knows which
  // flavor of Glade is running, and the card's advice has to name that one or none at all.
  readonly bundleId?: string;
}

function computerFailureNeedsSetup(error: unknown): boolean {
  if (error instanceof ComputerBackendError) return error.setupRequired;
  const cause: unknown = (error as { readonly cause?: unknown } | null)?.cause;
  return cause instanceof ComputerBackendError && cause.setupRequired;
}

// The setup state behind a tool call, or undefined when there is nothing for the user to do.
// `availability` outranks the rest because it is the most specific answer available: it names every
// missing grant, including ones no call has tripped over yet.
export function computerSetupSignal(input: {
  readonly error?: unknown;

  readonly availability?: ComputerAvailability | undefined;

  readonly missing?: readonly ComputerPermission[] | undefined;

  readonly buildSignature?: ComputerBuildSignature | undefined;

  readonly bundleId?: string | undefined;
}): ComputerSetupSignal | undefined {
  const resolvedBundleId = input.bundleId?.trim() || responsibleDesktopBundleId();
  const app = resolvedBundleId === undefined ? {} : { bundleId: resolvedBundleId };
  if (input.availability?.kind === "permission-required") {
    return {
      missing: input.availability.missing,
      blocking: true,
      buildSignature: input.availability.buildSignature,
      ...app,
    };
  }
  const signature =
    input.buildSignature === undefined ? {} : { buildSignature: input.buildSignature };
  const missing = input.missing ?? [];
  if (input.error !== undefined && computerFailureNeedsSetup(input.error)) {
    return { missing, blocking: true, ...signature, ...app };
  }
  return missing.length > 0
    ? { missing, blocking: computerGrantsBlockControl(missing), ...signature, ...app }
    : undefined;
}

// Deliberately terse and free of instructions the model could try to follow: the remedy is a setup
// card already in front of the human, so the agent's whole job here is to stop and say so.
// Detecting a missing grant is read-only — nothing is asked of macOS until the user runs the card's
// guided setup — so this note claims only what is on screen, never that a system prompt is already
// up.
export function computerSetupToolNote(signal: ComputerSetupSignal): string {
  const labels = listComputerPermissions(signal.missing);
  const needed = labels.length > 0 ? labels : "a macOS privacy permission";
  const asked = `Glade needs ${needed} and has shown the user a setup card with a guided flow.`;
  if (signal.blocking) {
    return (
      `${asked} Nothing on the desktop can be driven without it. ` +
      "Stop desktop automation, say in one sentence that you are waiting for the user to grant it, " +
      "and do not retry or work around it until the user says it is granted."
    );
  }

  return (
    `${asked} This one does not block desktop control — only the pictures: screenshots and the ` +
    "computer pane will fail while it is missing, and the window list, the accessibility state " +
    "and every input still work. Do not stop. Carry on with those, say once that you cannot see " +
    "the screen until the user grants it, and target controls by label rather than by coordinates."
  );
}
