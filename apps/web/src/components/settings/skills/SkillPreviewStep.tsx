import type { SkillAudit, SkillPreview } from "@glade/contracts/transport/ws/skillsDirectoryRpc";
import { type ReactNode, useState } from "react";

import {
  AlertCircleIcon,
  ArrowLeft02Icon,
  ArrowUpRightIcon,
  ComputerTerminal01Icon,
  DownloadIcon,
  File02Icon,
  LockKeyholeIcon,
  OctagonAlertIcon,
  ShieldCheckIcon,
  ShieldIcon,
  TriangleAlertIcon,
} from "~/lib/icons";
import type { NativeApi } from "@glade/contracts/ipc/ipc";
import { LOCAL_ENVIRONMENT } from "~/environments/environmentKey";
import { ensureEnvironmentNativeApi } from "~/nativeApi";
import { Button } from "../../ui/button";
import { DialogFooter, DialogHeader, DialogPanel, DialogTitle } from "../../ui/dialog";
import { IconButton } from "../../ui/icon-button";
import { Spinner } from "../../ui/spinner";
import { type AgentTarget, AgentTargetPicker } from "../AgentTargetPicker";

const sizeFormat = new Intl.NumberFormat("en", {
  style: "unit",
  unit: "kilobyte",
  maximumFractionDigits: 0,
});

function TrustRow(props: {
  readonly icon: ReactNode;
  readonly title: ReactNode;
  readonly detail?: ReactNode;
  readonly action?: ReactNode;
}) {
  return (
    <li className="flex min-w-0 items-start gap-2.5 px-3 py-2.5">
      <span className="mt-0.5 shrink-0 [&>svg]:size-4">{props.icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-ui-sm text-foreground">{props.title}</span>
        {props.detail ? (
          <span className="block text-ui-xs text-muted-foreground">{props.detail}</span>
        ) : null}
      </span>
      {props.action}
    </li>
  );
}

function auditIcon(status: string): ReactNode {
  switch (status.toLowerCase()) {
    case "pass":
      return <ShieldCheckIcon aria-hidden className="text-success" />;
    case "warn":
      return <TriangleAlertIcon aria-hidden className="text-warning" />;
    case "fail":
      return <OctagonAlertIcon aria-hidden className="text-destructive" />;
    default:
      return <ShieldIcon aria-hidden className="text-muted-foreground" />;
  }
}

function AuditRows(props: { readonly audits: ReadonlyArray<SkillAudit> | null }) {
  if (props.audits === null || props.audits.length === 0) {
    return (
      <TrustRow
        icon={<ShieldIcon aria-hidden className="text-muted-foreground" />}
        title={props.audits === null ? "Security audits are unavailable" : "No security audit yet"}
        detail="skills.sh publishes third-party audits for the skills it lists."
      />
    );
  }
  const passed = props.audits.filter((audit) => audit.status.toLowerCase() === "pass").length;
  return (
    <TrustRow
      icon={
        passed === props.audits.length ? (
          <ShieldCheckIcon aria-hidden className="text-success" />
        ) : (
          <TriangleAlertIcon aria-hidden className="text-warning" />
        )
      }
      title={`${passed} of ${props.audits.length} security audits passed`}
      detail={
        <span className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
          {props.audits.map((audit) => (
            <span
              key={audit.provider}
              className="inline-flex items-center gap-1 [&>svg]:size-3"
              title={audit.summary}
            >
              {auditIcon(audit.status)}
              {audit.provider}
            </span>
          ))}
        </span>
      }
    />
  );
}

export function SkillPreviewStep(props: {
  readonly api: NativeApi;
  readonly machineLabel: string | null;
  readonly preview: SkillPreview;
  readonly onBack: () => void;
  readonly onInstalled: (paths: ReadonlyArray<string>) => void;
}) {
  const { preview } = props;
  const [providers, setProviders] = useState<AgentTarget>(null);
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const owner = preview.repository.split("/")[0] ?? preview.repository;
  const totalBytes = preview.files.reduce((sum, file) => sum + file.size, 0);
  const sourceUrl = `https://github.com/${preview.repository}/tree/${preview.commit}/${preview.path}`;

  const install = () => {
    if (providers !== null && providers.length === 0) {
      setError("Choose at least one agent.");
      return;
    }
    setInstalling(true);
    setError(null);
    props.api.skillsDirectory
      .install({
        repository: preview.repository,
        commit: preview.commit,
        path: preview.path,
        providers,
      })
      .then((result) => props.onInstalled(result.installedPaths))
      .catch((cause: unknown) => {
        setInstalling(false);
        setError(cause instanceof Error ? cause.message : "Try again.");
      });
  };

  return (
    <>
      <DialogHeader className="px-5 pt-5">
        <div className="flex items-center gap-2">
          <IconButton
            variant="ghost"
            size="icon-xs"
            label="Back to search"
            className="-ml-1.5"
            disabled={installing}
            onClick={props.onBack}
          >
            <ArrowLeft02Icon />
          </IconButton>
          <DialogTitle className="truncate">{preview.name}</DialogTitle>
        </div>
        {preview.description ? (
          <p className="line-clamp-3 text-ui-sm text-muted-foreground" title={preview.description}>
            {preview.description}
          </p>
        ) : null}
      </DialogHeader>
      <DialogPanel className="mt-2 flex flex-col gap-4 px-5">
        <ul className="divide-y divide-border rounded-xl border border-border">
          <TrustRow
            icon={<LockKeyholeIcon aria-hidden className="text-muted-foreground" />}
            title={
              <>
                {preview.repository}
                {preview.path ? (
                  <span className="text-muted-foreground">/{preview.path}</span>
                ) : null}
              </>
            }
            detail={`Pinned to commit ${preview.commit.slice(0, 7)}; later changes are never installed on their own.`}
            action={
              <IconButton
                variant="ghost"
                size="icon-xs"
                label="View on GitHub"
                onClick={() =>
                  void ensureEnvironmentNativeApi(LOCAL_ENVIRONMENT).shell.openExternal(sourceUrl)
                }
              >
                <ArrowUpRightIcon />
              </IconButton>
            }
          />
          {preview.hasScripts ? (
            <TrustRow
              icon={<ComputerTerminal01Icon aria-hidden className="text-warning" />}
              title="Includes scripts"
              detail={`Agents can run them with your permissions. Install it only if you trust ${owner}.`}
            />
          ) : (
            <TrustRow
              icon={<File02Icon aria-hidden className="text-success" />}
              title="Instructions only"
              detail="No scripts or executable files."
            />
          )}
          <AuditRows audits={preview.audits} />
        </ul>
        <AgentTargetPicker value={providers} onChange={setProviders} disabled={installing} />
        <div className="flex flex-col gap-1.5">
          <span className="text-ui-xs text-muted-foreground">
            SKILL.md · {preview.files.length} {preview.files.length === 1 ? "file" : "files"},{" "}
            {sizeFormat.format(Math.max(1, Math.round(totalBytes / 1024)))}
          </span>
          <pre className="h-40 overflow-auto rounded-xl border border-border bg-[var(--color-background-elevated-secondary)] p-3 font-mono text-ui-xs whitespace-pre-wrap text-muted-foreground">
            {preview.instructions}
          </pre>
        </div>
      </DialogPanel>
      <DialogFooter className="items-center">
        {error ? (
          <p role="alert" className="mr-auto flex items-center gap-1.5 text-ui-sm text-destructive">
            <AlertCircleIcon aria-hidden className="size-3.5 shrink-0" />
            {error}
          </p>
        ) : null}
        <Button type="button" disabled={installing} onClick={install}>
          {installing ? <Spinner className="size-4" /> : <DownloadIcon aria-hidden />}
          {props.machineLabel ? `Install on ${props.machineLabel}` : "Install"}
        </Button>
      </DialogFooter>
    </>
  );
}
