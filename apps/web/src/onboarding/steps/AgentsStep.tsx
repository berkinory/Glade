import type { ProviderKind } from "@glade/contracts/core/baseSchemas";
import type { ServerProviderStatus } from "@glade/contracts/server/server";
import { PROVIDER_DESCRIPTORS } from "@glade/shared/provider/providerMetadata";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useAppSettings } from "~/appSettings";
import { ProviderIcon } from "~/components/ProviderIcon";
import { ProviderSignIn } from "~/components/settings/ProviderSignIn";
import { providerSetupStatus } from "~/components/settings/providerSetupStatus";
import { SettingsStatus } from "~/components/settings/SettingsStatus";
import { Spinner } from "~/components/ui/spinner";
import { Switch } from "~/components/ui/switch";
import { LOCAL_ENVIRONMENT } from "~/environments/environmentKey";
import { useProviderStatusesForLocalConfig } from "~/hooks/useProviderStatusesForLocalConfig";
import { ExternalLinkIcon, RefreshCwIcon } from "~/lib/icons";
import { findProviderStatus } from "~/lib/providerAvailability";
import { hasReconciledServerProviderStatuses } from "~/lib/serverReactQuery";
import { cn } from "~/lib/utils";
import type { ProviderDetection } from "../useProviderDetection";

type ProviderDescriptor = (typeof PROVIDER_DESCRIPTORS)[number];

// `disabledProviders` is server-owned and reaches local settings only after the round-trip, so each
// write derives from this draft; deriving from settings would let a quick second toggle drop the first.
function useDisabledProvidersDraft() {
  const { settings, updateSettingsAndWait } = useAppSettings();
  const [draft, setDraft] = useState<ReadonlySet<ProviderKind>>(
    () => new Set(settings.disabledProviders),
  );
  const draftRef = useRef(draft);
  const [pendingWrites, setPendingWrites] = useState(0);
  const serverDisabledProviders = settings.disabledProviders;
  useEffect(() => {
    if (pendingWrites > 0) return;
    const next = new Set(serverDisabledProviders);
    draftRef.current = next;
    setDraft(next);
  }, [pendingWrites, serverDisabledProviders]);
  const setProviderDisabled = (provider: ProviderKind, disabled: boolean) => {
    const next = new Set(draftRef.current);
    if (disabled) next.add(provider);
    else next.delete(provider);
    draftRef.current = next;
    setDraft(next);
    setPendingWrites((count) => count + 1);
    void updateSettingsAndWait({ disabledProviders: [...next] }).finally(() =>
      setPendingWrites((count) => count - 1),
    );
  };
  return { disabled: draft, setProviderDisabled };
}

function AgentRow(props: {
  descriptor: ProviderDescriptor;
  status: ServerProviderStatus | undefined;
  reconciled: boolean;
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
}) {
  const { descriptor, status } = props;
  const setup = providerSetupStatus({
    status,
    reconciled: props.reconciled,
    disabled: !props.enabled,
  });
  const ready = setup.tone === "granted";
  const needsSignIn = props.enabled && status?.available && status.authStatus === "unauthenticated";
  const notInstalled =
    props.enabled && props.reconciled && status !== undefined && !status.available;
  const installHref = descriptor.installDocs[0]?.href ?? descriptor.setupDocsHref;
  return (
    <li className="rounded-xl border border-foreground/7">
      <div className="flex items-center gap-3 py-2.5 ps-3 pe-3.5">
        <span
          className={cn(
            "flex size-8 shrink-0 items-center justify-center rounded-lg bg-foreground/5",
            !props.enabled && "opacity-50",
          )}
        >
          <ProviderIcon provider={descriptor.kind} className="size-4.5" />
        </span>
        <span className={cn("flex min-w-0 flex-1 flex-col", !props.enabled && "opacity-60")}>
          <span className="truncate text-ui-lg font-medium text-foreground">
            {descriptor.displayName}
          </span>
          <span className="text-ui-sm text-muted-foreground">
            <SettingsStatus tone={setup.tone} label={setup.label} />
          </span>
        </span>
        {notInstalled ? (
          <a
            href={installHref}
            target="_blank"
            rel="noreferrer"
            className="inline-flex shrink-0 items-center gap-1 text-ui-sm text-muted-foreground transition-colors hover:text-foreground motion-reduce:transition-none"
          >
            Install guide
            <ExternalLinkIcon className="size-[0.923em]" aria-hidden />
          </a>
        ) : null}
        <Switch
          checked={props.enabled}
          onCheckedChange={(checked) => props.onEnabledChange(checked === true)}
          aria-label={`Use ${descriptor.displayName}`}
        />
      </div>
      {needsSignIn ? (
        <div className="ps-[52px]">
          <ProviderSignIn provider={descriptor.kind} authenticated={ready} />
        </div>
      ) : null}
    </li>
  );
}

export function AgentsStep(props: { readonly detection: ProviderDetection }) {
  const { detection } = props;
  const queryClient = useQueryClient();
  const statuses = useProviderStatusesForLocalConfig(LOCAL_ENVIRONMENT);
  const reconciled = hasReconciledServerProviderStatuses(queryClient) && !detection.detecting;
  const { disabled, setProviderDisabled } = useDisabledProvidersDraft();

  return (
    <div className="flex flex-col gap-3">
      <ul aria-label="Agents" className="flex flex-col gap-1.5">
        {PROVIDER_DESCRIPTORS.map((descriptor) => (
          <AgentRow
            key={descriptor.kind}
            descriptor={descriptor}
            status={findProviderStatus(statuses, descriptor.kind) ?? undefined}
            reconciled={reconciled}
            enabled={!disabled.has(descriptor.kind)}
            onEnabledChange={(enabled) => setProviderDisabled(descriptor.kind, !enabled)}
          />
        ))}
      </ul>
      <div className="flex items-center justify-between gap-3 text-ui-sm text-muted-foreground">
        <span>Pick the agent and model for each chat in the composer.</span>
        <button
          type="button"
          disabled={detection.detecting}
          className="inline-flex shrink-0 cursor-pointer items-center gap-1.5 transition-colors hover:text-foreground disabled:cursor-default motion-reduce:transition-none"
          onClick={() => void detection.detect()}
        >
          {detection.detecting ? (
            <Spinner variant="action" className="size-[1.077em]" aria-hidden />
          ) : (
            <RefreshCwIcon className="size-[1.077em]" aria-hidden />
          )}
          Check again
        </button>
      </div>
    </div>
  );
}
