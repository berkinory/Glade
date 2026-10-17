import { PROVIDER_DESCRIPTORS } from "@glade/shared/provider/providerMetadata";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useAppSettings } from "~/appSettings";
import { APP_BASE_NAME } from "~/branding";
import { providerSetupStatus } from "~/components/settings/providerSetupStatus";
import { Dialog, DialogDescription, DialogPopup, DialogTitle } from "~/components/ui/dialog";
import { LOCAL_ENVIRONMENT } from "~/environments/environmentKey";
import { useHandleNewThread } from "~/hooks/useHandleNewThread";
import { useProviderStatusesForLocalConfig } from "~/hooks/useProviderStatusesForLocalConfig";
import { useTheme } from "~/hooks/useTheme";
import { findProviderStatus } from "~/lib/providerAvailability";
import { providerNames } from "~/lib/providerNames";
import { serverSettingsQueryOptions } from "~/lib/serverReactQuery";
import { cn } from "~/lib/utils";
import type { SettingsSectionId } from "~/settingsNavigation";
import {
  isOnboardingSetupStep,
  nextOnboardingStep,
  previousOnboardingStep,
  type OnboardingStep,
} from "./logic";
import { OnboardingAside } from "./OnboardingAside";
import { useOnboardingDialogStore } from "./onboardingDialogStore";
import { OnboardingStepFooter } from "./OnboardingStepFooter";
import { AgentsStep } from "./steps/AgentsStep";
import { PermissionsStep } from "./steps/PermissionsStep";
import { StartStep, type OnboardingProjectResult } from "./steps/StartStep";
import { WelcomeStep } from "./steps/WelcomeStep";
import { useProviderDetection } from "./useProviderDetection";

const STEP_COPY: Record<OnboardingStep, { title: string; description: string }> = {
  welcome: {
    title: "A quiet place for loud work.",
    description: `Run ${providerNames(PROVIDER_DESCRIPTORS.map((descriptor) => descriptor.kind))} side by side on this machine, with the accounts you already have. There is no ${APP_BASE_NAME} account to create.`,
  },
  agents: {
    title: "Choose your agents",
    description: `${APP_BASE_NAME} found these on this machine. Turn off any agent you don't want ${APP_BASE_NAME} to run.`,
  },
  permissions: {
    title: "Decide what agents may touch",
    description: "Agents still ask before they use each app. Change any of this later in Settings.",
  },
  start: {
    title: "Bring in your work",
    description:
      "A project is a folder agents work in. Git repositories add branches, worktrees, diffs and pull requests.",
  },
};

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function useStepSummaries(
  visited: ReadonlySet<OnboardingStep>,
  detecting: boolean,
  projectCount: number,
): Record<OnboardingStep, string> {
  const { settings } = useAppSettings();
  const { theme } = useTheme();
  const statuses = useProviderStatusesForLocalConfig(LOCAL_ENVIRONMENT);
  const serverSettings = useQuery(serverSettingsQueryOptions()).data;
  const enabled = PROVIDER_DESCRIPTORS.filter(
    (descriptor) => !settings.disabledProviders.includes(descriptor.kind),
  );
  const ready = enabled.filter(
    (descriptor) =>
      providerSetupStatus({
        status: findProviderStatus(statuses, descriptor.kind) ?? undefined,
        reconciled: true,
        disabled: false,
      }).tone === "granted",
  ).length;
  const allowed = [
    serverSettings?.allowComputerUse ? "Computer Use" : null,
    serverSettings?.keepAwakeMode === "agent" ? "Keep awake" : null,
  ].filter((entry) => entry !== null);
  return {
    welcome:
      theme === "system"
        ? "System appearance"
        : `${theme === "dark" ? "Dark" : "Light"} appearance`,
    agents: !visited.has("agents")
      ? "Agents on this machine"
      : detecting
        ? "Checking agents…"
        : enabled.length === 0
          ? "No agents turned on"
          : `${ready} of ${plural(enabled.length, "agent")} ready`,
    permissions: !visited.has("permissions")
      ? "Computer Use and sleep"
      : allowed.length > 0
        ? allowed.join(" · ")
        : "Nothing extra allowed",
    start: projectCount > 0 ? plural(projectCount, "project") : "Add a folder, or just chat",
  };
}

function OnboardingFlow(props: {
  onComplete: () => void;
  projectBusy: boolean;
  onProjectBusyChange: (busy: boolean) => void;
}) {
  const [step, setStep] = useState<OnboardingStep>("welcome");
  const [visited, setVisited] = useState<ReadonlySet<OnboardingStep>>(() => new Set(["welcome"]));
  const [projectResults, setProjectResults] = useState<ReadonlyArray<OnboardingProjectResult>>([]);
  const providerDetection = useProviderDetection();
  const summaries = useStepSummaries(visited, providerDetection.detecting, projectResults.length);
  const navigate = useNavigate();
  const { handleNewThread } = useHandleNewThread();

  const goTo = (next: OnboardingStep) => {
    setStep(next);
    setVisited((current) => (current.has(next) ? current : new Set([...current, next])));
  };
  // Once the user reaches a setup step the first-run gate must not auto-close the dialog.
  const markEngaged = useOnboardingDialogStore((store) => store.markEngaged);
  useEffect(() => {
    if (isOnboardingSetupStep(step)) markEngaged();
  }, [markEngaged, step]);

  const finish = () => {
    props.onComplete();
    const firstProject = projectResults[0];
    if (firstProject) void handleNewThread(firstProject.projectId);
  };
  const openSettings = (section: SettingsSectionId) => {
    props.onComplete();
    void navigate({ to: "/settings", search: { section } });
  };
  const primaryLabel =
    step === "welcome"
      ? "Begin"
      : step !== "start"
        ? "Continue"
        : projectResults.length > 0
          ? "Open first chat"
          : "Start chatting";
  const copy = STEP_COPY[step];

  return (
    <div className="grid min-h-0 flex-1 grid-cols-[320px_minmax(0,1fr)] outline-none" tabIndex={-1}>
      <OnboardingAside
        step={step}
        visited={visited}
        summaries={summaries}
        navigationLocked={props.projectBusy}
        onSelect={goTo}
      />
      <div className="flex min-h-0 min-w-0 flex-col">
        <div
          className={cn(
            "flex min-h-0 flex-1 flex-col overflow-y-auto px-10 pt-12 pb-8",
            step === "welcome" && "justify-center pb-16",
          )}
        >
          <header
            className={cn(
              "flex flex-col gap-3",
              step === "welcome" ? "mb-9 max-w-[520px]" : "mb-7",
            )}
          >
            <DialogTitle
              className={cn(
                "font-serif font-normal tracking-[-0.015em] text-foreground",
                step === "welcome" ? "text-[40px] leading-[1.08]" : "text-[30px] leading-tight",
              )}
            >
              {copy.title}
            </DialogTitle>
            <DialogDescription className="max-w-[540px] text-ui-lg leading-relaxed">
              {copy.description}
            </DialogDescription>
          </header>
          {step === "welcome" ? <WelcomeStep /> : null}
          {step === "agents" ? <AgentsStep detection={providerDetection} /> : null}
          {step === "permissions" ? <PermissionsStep /> : null}
          {step === "start" ? (
            <StartStep
              results={projectResults}
              onBusyChange={props.onProjectBusyChange}
              onOpenSettings={openSettings}
              onResult={(result) =>
                setProjectResults((current) =>
                  current.some((entry) => entry.projectId === result.projectId)
                    ? current
                    : [...current, result],
                )
              }
            />
          ) : null}
        </div>
        <OnboardingStepFooter
          showBack={step !== "welcome"}
          onBack={() => goTo(previousOnboardingStep(step))}
          onSkip={props.onComplete}
          primaryLabel={primaryLabel}
          onPrimary={step === "start" ? finish : () => goTo(nextOnboardingStep(step))}
          busy={props.projectBusy}
        />
      </div>
    </div>
  );
}

export function OnboardingDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onComplete: () => void;
}) {
  const [projectBusy, setProjectBusy] = useState(false);
  const setPresented = useOnboardingDialogStore((store) => store.setPresented);
  useEffect(() => {
    if (props.open) setPresented(true);
  }, [props.open, setPresented]);
  const handleOpenChange = (open: boolean) => {
    if (!open && projectBusy) return;
    props.onOpenChange(open);
  };
  return (
    <Dialog
      open={props.open}
      onOpenChange={handleOpenChange}
      onOpenChangeComplete={(open) => {
        if (!open) setPresented(false);
      }}
    >
      <DialogPopup
        showCloseButton
        className="h-[min(720px,calc(100dvh-2rem))] max-h-full max-w-[1060px] overflow-hidden"
      >
        {props.open ? (
          <OnboardingFlow
            onComplete={props.onComplete}
            projectBusy={projectBusy}
            onProjectBusyChange={setProjectBusy}
          />
        ) : null}
      </DialogPopup>
    </Dialog>
  );
}
