import { useQuery } from "@tanstack/react-query";
import { useProvisionComputer } from "~/hooks/useProvisionComputer";
import { useRefreshOnWindowReturn } from "~/hooks/useRefreshOnWindowReturn";
import {
  computerStatusQueryOptions,
  COMPUTER_STATUS_VISIBLE_REFETCH_INTERVAL_MS,
} from "~/lib/serverReactQuery";
import { computerStatusNeedsSetup, resolveComputerAvailabilityView } from "../ComputerPanel.logic";
import type {
  ComputerBuildSignature,
  ComputerPermission,
  ComputerStatusResult,
} from "@glade/contracts/computer/computer";
import { computerStaleGrantAdvice, listComputerPermissions } from "@glade/shared/computerGrants";

import { ComputerActionCard } from "./ComputerActionCard";

export function ComputerSetupRequiredCard({
  missing,
  buildSignature,
  bundleId,
  computerControlReady,
  status,
  statusError,
  isPending = false,
  textFontSizePx,
  metaFontSizePx,
  onSetUp,
  onRecheck,
}: {
  // Naming them is most of this card's value: "a permission Glade needs" sends the user hunting
  // through Privacy & Security, while "Accessibility" tells them exactly which switch to find.
  readonly missing?: readonly ComputerPermission[];

  readonly buildSignature?: ComputerBuildSignature;

  readonly bundleId?: string;

  readonly computerControlReady?: boolean;
  readonly status?: ComputerStatusResult;
  readonly statusError?: string;
  readonly isPending?: boolean;
  readonly textFontSizePx?: number;
  readonly metaFontSizePx?: number;
  readonly onSetUp?: () => void;
  readonly onRecheck?: () => void;
}) {
  const ready =
    !statusError &&
    (status
      ? status.availability.kind === "available" &&
        status.health.status === "connected" &&
        !computerStatusNeedsSetup(status)
      : computerControlReady === true);
  const availability = status?.availability;
  const livePermission = availability?.kind === "permission-required" ? availability : undefined;
  const currentMissing = statusError
    ? []
    : status
      ? (livePermission?.missing ?? [])
      : (missing ?? []);
  const missingLabels = listComputerPermissions(currentMissing);
  const currentSignature = status ? livePermission?.buildSignature : buildSignature;
  const currentBundleId = status ? livePermission?.bundleId : bundleId;
  const availabilityView = status
    ? resolveComputerAvailabilityView(status.availability, status.health)
    : undefined;
  const title = statusError
    ? "Computer status is unavailable"
    : ready
      ? "Computer control is ready"
      : missingLabels
        ? `Computer control needs ${missingLabels}`
        : (availabilityView?.title ?? "Computer control needs setup");
  const description = statusError
    ? statusError
    : ready
      ? "Send a message and the agent will pick up where it left off."
      : missingLabels
        ? "Choose Set up to request missing permissions or open System Settings. Allow access for this Glade app, then return here to recheck."
        : (availabilityView?.description ??
          "Choose Set up to check permissions and prepare computer control.");
  const canSetUp =
    !ready &&
    !statusError &&
    availability?.kind !== "unsupported-platform" &&
    status?.provisionable !== false;

  const staleGrantAdvice =
    !ready && currentSignature
      ? computerStaleGrantAdvice(currentMissing, currentSignature, currentBundleId)
      : null;
  return (
    <ComputerActionCard
      tone={statusError ? "error" : ready ? "success" : "warning"}
      title={title}
      textFontSizePx={textFontSizePx}
      metaFontSizePx={metaFontSizePx}
      action={
        onSetUp && canSetUp
          ? { label: isPending ? "Setting up…" : "Set up", disabled: isPending, onClick: onSetUp }
          : statusError && onRecheck
            ? { label: "Recheck", onClick: onRecheck }
            : undefined
      }
    >
      <p>{description}</p>
      {staleGrantAdvice ? <p>{staleGrantAdvice}</p> : null}
    </ComputerActionCard>
  );
}

export function ConnectedComputerSetupRequiredCard(
  props: Parameters<typeof ComputerSetupRequiredCard>[0],
) {
  const statusQuery = useQuery({
    ...computerStatusQueryOptions(),
    refetchInterval: COMPUTER_STATUS_VISIBLE_REFETCH_INTERVAL_MS,
  });
  const status = statusQuery.data;
  useRefreshOnWindowReturn(() => statusQuery.refetch({ cancelRefetch: false }));
  const missing = status
    ? status.availability.kind === "permission-required"
      ? status.availability.missing
      : []
    : props.missing;
  const setup = useProvisionComputer({
    ...(missing ? { missing } : {}),
    notify: true,
  });
  return (
    <div className="space-y-2">
      <ComputerSetupRequiredCard
        {...props}
        {...(status ? { status } : {})}
        {...(statusQuery.isError
          ? {
              statusError:
                statusQuery.error instanceof Error && statusQuery.error.message
                  ? statusQuery.error.message
                  : "Could not check computer access. Try again.",
            }
          : {})}
        isPending={setup.isPending}
        onSetUp={setup.provision}
        onRecheck={() => void statusQuery.refetch()}
      />
    </div>
  );
}
