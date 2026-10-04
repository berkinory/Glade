import { useDesktopMenuShortcuts } from "../hooks/useDesktopMenuShortcuts";
import { type WsCompatibilityError } from "@glade/contracts/transport/ws/wsCompatibility";
import { Outlet } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { DiffWorkerPoolProvider } from "../components/DiffWorkerPoolProvider";
import { BrowserVaultDialog } from "~/components/BrowserVault";
import { APP_DISPLAY_NAME, APP_VERSION } from "../branding";
import { DesktopWindowControls } from "../components/DesktopWindowControls";
import { QueuedComposerDrainCoordinator } from "../components/QueuedComposerDrainCoordinator";
import { RunningChatsQuitCoordinator } from "../components/RunningChatsQuitCoordinator";
import { Button, dialogActionButtonClassName } from "../components/ui/button";
import { AnchoredToastProvider, ToastProvider } from "../components/ui/toast";
import { useGitProgressToastPreview } from "../components/useGitProgressToastPreview";
import { useFeatureFlags } from "../featureFlags";
import { useAppDensity } from "../hooks/useAppDensity";
import { useAppTypography } from "../hooks/useAppTypography";
import { useChatWidth } from "../hooks/useChatWidth";
import { useDesktopAppIcon } from "../hooks/useDesktopAppIcon";
import { useSyncDesktopTopBarTrafficLightGutterZoom } from "../hooks/useDesktopTopBarGutter";
import { useNativeFontSmoothing } from "../hooks/useNativeFontSmoothing";
import { useGitStatusPush } from "../hooks/useGitStatusPush";
import { usePreloadRouteChunks } from "../hooks/usePreloadRouteChunks";
import { useTheme } from "../hooks/useTheme";
import { readNativeApi } from "../nativeApi";
import { TaskCompletionNotifications } from "../notifications/taskCompletion";
import {
  addWsCompatibilityIssueListener,
  readLatestWsCompatibilityIssue,
} from "../wsTransportEvents";
import { DesktopProjectBootstrap } from "./-rootDesktopBootstrap";
import {
  GlobalFeedbackDialog,
  GlobalOnboardingDialog,
  GlobalShortcutsDialog,
  GlobalWhatsNewSurface,
} from "./-rootDialogs";
import { EventRouter } from "./-rootEventRouter";
import { ProviderStatusRefreshCoordinator } from "./-rootProviders";
export function RootRouteView() {
  useAppTypography();
  useAppDensity();
  useChatWidth();
  useDesktopAppIcon();
  useDesktopMenuShortcuts();
  usePreloadRouteChunks();
  useGitStatusPush();
  useNativeFontSmoothing();
  useSyncDesktopTopBarTrafficLightGutterZoom();
  useTheme();
  const [compatibilityIssue, setCompatibilityIssue] = useState<WsCompatibilityError | null>(() =>
    readLatestWsCompatibilityIssue(),
  );
  useEffect(
    () =>
      addWsCompatibilityIssueListener(setCompatibilityIssue, {
        replayCurrent: true,
      }),
    [],
  );

  // The cluster is pinned to the window's top-right corner (frameless Windows/Linux shell) and
  // renders nothing on macOS or the web build, so it is safe to mount unconditionally here —
  // including on the pre-backend "connecting" screen, so the window stays closable before the
  // renderer connects. The route headers are full-width `drag-region`s that extend under this
  // cluster, so the cluster's `no-drag` rect has to be subtracted AFTER those drag rects are added —
  // otherwise the OS reclaims the corner as title-bar caption and swallows the click as a window drag
  // (the buttons render but do nothing). Rendering it last in document order guarantees that
  // subtraction wins. (z above dialogs/toasts so it also stays clickable while a modal is open.)
  const desktopWindowControls = <DesktopWindowControls className="fixed top-0 right-0 z-[250]" />;
  const desktopChrome = (
    <>
      <RunningChatsQuitCoordinator />
      {desktopWindowControls}
    </>
  );

  if (compatibilityIssue) {
    return (
      <>
        <TransportCompatibilityView issue={compatibilityIssue} />
        {desktopChrome}
      </>
    );
  }

  if (!readNativeApi()) {
    return (
      <>
        <div className="flex h-screen flex-col bg-background text-foreground">
          <div className="flex flex-1 items-center justify-center">
            <p className="text-ui leading-snug text-muted-foreground">
              Connecting to {APP_DISPLAY_NAME} server...
            </p>
          </div>
        </div>
        {desktopChrome}
      </>
    );
  }

  return (
    <>
      <ToastProvider position="top-center">
        <AnchoredToastProvider>
          <DiffWorkerPoolProvider>
            <GitProgressToastPreviewDev />
            <EventRouter />
            <ProviderStatusRefreshCoordinator />
            <GlobalShortcutsDialog />
            <BrowserVaultDialog />
            <GlobalFeedbackDialog />
            <GlobalWhatsNewSurface />
            <TaskCompletionNotifications />
            <QueuedComposerDrainCoordinator />

            <GlobalOnboardingDialog />

            <DesktopProjectBootstrap />
            <Outlet />
          </DiffWorkerPoolProvider>
        </AnchoredToastProvider>
      </ToastProvider>
      {desktopChrome}
    </>
  );
}
function TransportCompatibilityView({ issue }: { issue: WsCompatibilityError }) {
  const title =
    issue.action === "update-client"
      ? "This Glade client needs an update."
      : issue.action === "update-server"
        ? "The Glade server needs an update."
        : "Glade needs to reconnect with a matching build.";
  const guidance =
    issue.action === "update-client"
      ? "Update or reload this client, then reconnect."
      : issue.action === "update-server"
        ? "Update or restart the server, then reload this client."
        : "Reload the app. If this repeats, restart Glade so the client and server use matching builds.";

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-4 py-10 text-foreground sm:px-6">
      <div className="pointer-events-none absolute inset-0 opacity-80">
        <div className="absolute inset-x-0 top-0 h-44 bg-[radial-gradient(44rem_16rem_at_top,color-mix(in_srgb,var(--color-amber-500)_16%,transparent),transparent)]" />
        <div className="absolute inset-0 bg-[linear-gradient(145deg,color-mix(in_srgb,var(--background)_90%,var(--color-black))_0%,var(--background)_55%)]" />
      </div>
      <section className="relative w-full max-w-xl rounded-2xl border border-border/80 bg-card/90 p-6 shadow-2xl shadow-black/20 backdrop-blur-md sm:p-8">
        <p className="text-ui-sm font-semibold text-muted-foreground">{APP_DISPLAY_NAME}</p>
        <h1 className="mt-3 text-2xl font-semibold sm:text-3xl">{title}</h1>
        <p className="mt-2 text-ui leading-relaxed text-muted-foreground">{issue.message}</p>
        <p className="mt-2 text-ui leading-relaxed text-muted-foreground">{guidance}</p>
        <p className="mt-4 text-ui leading-snug text-muted-foreground/80">
          Client {APP_VERSION} · Server {issue.serverBuild}
        </p>
        <div className="mt-5">
          <Button
            size="sm"
            className={dialogActionButtonClassName}
            onClick={() => window.location.reload()}
          >
            Reload app
          </Button>
        </div>
      </section>
    </div>
  );
}
function GitProgressToastPreviewDev() {
  const featureFlags = useFeatureFlags();
  const enabled = import.meta.env.DEV && featureFlags["pin-git-progress-toast-preview"];
  useGitProgressToastPreview(enabled);
  return null;
}
