import type { ServerLocalServerProcess } from "@glade/contracts/server/server";
import {
  localServerAddressLabel,
  localServerFolderLabel,
  localServerPrimaryLabel,
} from "@glade/shared/localServers";

import { cn } from "~/lib/utils";

export type LocalServerIdentityTone = "menu" | "browser";

interface LocalServerIdentityToneTokens {
  primary: string;
  meta: string;
  address: string;
  separator: string;
  folder: string;
}

const IDENTITY_TONE: Record<LocalServerIdentityTone, LocalServerIdentityToneTokens> = {
  menu: {
    primary: "text-ui font-normal text-[var(--color-text-foreground)]",
    meta: "text-ui-xs text-muted-foreground/65",
    address: "tabular-nums",
    separator: "text-muted-foreground/30",
    folder: "text-muted-foreground/45",
  },
  browser: {
    primary: "text-ui-lg font-semibold text-white",
    meta: "text-ui text-white/35",
    address: "",
    separator: "text-white/20",
    folder: "text-white/30",
  },
};

export function LocalServerIdentity({
  server,
  tone,
}: {
  server: ServerLocalServerProcess;
  tone: LocalServerIdentityTone;
}) {
  const tokens = IDENTITY_TONE[tone];
  const primaryLabel = localServerPrimaryLabel(server);
  const addressLabel = localServerAddressLabel(server);
  const folderLabel = localServerFolderLabel(server);

  return (
    <span className="min-w-0">
      <span className={cn("block truncate leading-tight", tokens.primary)} title={primaryLabel}>
        {primaryLabel}
      </span>
      <span className={cn("mt-0.5 flex items-center gap-1.5 leading-tight", tokens.meta)}>
        <span className={cn("shrink-0", tokens.address)}>{addressLabel}</span>
        {folderLabel ? (
          <>
            <span className={tokens.separator} aria-hidden>
              ·
            </span>
            <span className={cn("truncate", tokens.folder)} title={server.cwd}>
              {folderLabel}
            </span>
          </>
        ) : null}
      </span>
    </span>
  );
}
