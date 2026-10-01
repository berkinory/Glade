import { MessageId, ThreadId, type TurnId } from "@glade/contracts/core/baseSchemas";
import {
  OrchestrationThreadActivity,
  type PinnedMessage,
} from "@glade/contracts/orchestration/threadEntities";
import { type ServerProviderStatus } from "@glade/contracts/server/server";
import { type EditorId } from "@glade/contracts/settings/editor";
import { type ResolvedKeybindingsConfig } from "@glade/contracts/settings/keybindings";
import { lazy } from "react";
import { type RateLimitStatus } from "~/components/chat/RateLimitBanner";
import { Skeleton } from "~/components/ui/skeleton";
import { RefreshCwIcon } from "~/lib/icons";
import { cn } from "~/lib/utils";
import { type SplitViewPanePanelState } from "~/splitViewModel";
import { type ChatMessage, type Thread } from "~/types";
export const ThreadTerminalDrawer = lazy(() => import("~/components/ThreadTerminalDrawer"));
export const EMPTY_ACTIVITIES: OrchestrationThreadActivity[] = [];
export const EMPTY_MESSAGES: ChatMessage[] = [];
export const EMPTY_PINNED_MESSAGES: readonly PinnedMessage[] = [];

export const EMPTY_PINNED_TEXT: ReadonlyMap<MessageId, string> = new Map();
export const EMPTY_KEYBINDINGS: ResolvedKeybindingsConfig = [];
export const COMPOSER_EXTRAS_PANEL_ID = "composer-extras-panel";
export const EMPTY_AVAILABLE_EDITORS: EditorId[] = [];
export const EMPTY_TERMINAL_RUNTIME_ENV: Record<string, string> = {};
export const MAX_DISMISSED_PROVIDER_HEALTH_BANNERS = 50;
export const EMPTY_DISMISSED_PROVIDER_HEALTH_BANNERS: ReadonlyArray<string> = [];
export function getProviderHealthBannerDismissalKey(
  status: ServerProviderStatus | null,
): string | null {
  if (!status || status.status === "ready") {
    return null;
  }
  return [
    status.provider,
    status.status,
    status.available ? "available" : "unavailable",
    status.authStatus,
    status.message?.trim() ?? "",
  ].join("\u001f");
}
export function getRateLimitBannerDismissalKey(
  status: RateLimitStatus | null,
  threadId: Thread["id"] | null,
): string | null {
  if (!status || !threadId) {
    return null;
  }
  return [
    threadId,
    status.status,
    status.resetsAt ?? "",
    typeof status.utilization === "number" ? String(Math.round(status.utilization * 100)) : "",
  ].join("\u001f");
}
export const VOICE_RECORDER_ACTION_ARM_DELAY_MS = 250;
export function warnVoiceGuard(event: string, details?: Record<string, unknown>) {
  if (!import.meta.env.DEV) {
    return;
  }
  if (details) {
    console.warn(`[voice] ${event}`, details);
    return;
  }
  console.warn(`[voice] ${event}`);
}
export function ComposerControlSkeleton(props: { widthClassName: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "flex h-8 shrink-0 items-center rounded-md border border-border/50 px-2",
        props.widthClassName,
      )}
    >
      <Skeleton className="h-3.5 w-full rounded-full" />
    </div>
  );
}
export function ComposerModelLoadingControl(props: { widthClassName: string }) {
  return (
    <div
      aria-label="Loading models"
      className={cn(
        "flex h-8 shrink-0 items-center gap-2 rounded-md border border-border/50 px-2 text-muted-foreground",
        props.widthClassName,
      )}
    >
      <RefreshCwIcon aria-hidden="true" className="size-3.5 animate-spin" />
      <span className="truncate text-ui-xs">Loading models</span>
    </div>
  );
}
export interface ChatViewProps {
  threadId: ThreadId;
  hideHeader?: boolean;
  paneScopeId?: string;
  surfaceMode?: "single" | "split";
  isFocusedPane?: boolean;
  panelState?: SplitViewPanePanelState;
  onToggleDiffPanel?: () => void;
  onToggleRightDock?: () => void;
  onToggleTerminal?: () => void;
  onOpenTerminal?: () => void;
  onToggleBrowserPanel?: () => void;
  onOpenBrowserUrl?: (url: string) => void;
  onOpenTurnDiffPanel?: (turnId: TurnId, filePath?: string) => void;
  onSplitSurface?: () => void;
  onMaximizeSurface?: () => void;
  onChangeThreadInSplitPane?: () => void;
}
