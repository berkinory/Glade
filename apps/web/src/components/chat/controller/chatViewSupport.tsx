import { MessageId, ThreadId, type TurnId } from "@glade/contracts/core/baseSchemas";
import {
  OrchestrationThreadActivity,
  type PinnedMessage,
} from "@glade/contracts/orchestration/threadEntities";
import { type ServerProviderStatus } from "@glade/contracts/server/server";
import { type EditorId } from "@glade/contracts/settings/editor";
import { type ResolvedKeybindingsConfig } from "@glade/contracts/settings/keybindings";
import { type RateLimitStatus } from "~/components/chat/RateLimitBanner";
import { type ChatMessage, type Thread } from "~/types";
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
export interface ChatViewProps {
  threadId: ThreadId;
  hideHeader?: boolean;
  diffPanelOpen?: boolean;
  onToggleDiffPanel?: () => void;
  onToggleTerminal?: () => void;
  onOpenTerminal?: () => void;
  onOpenTurnDiffPanel?: (turnId: TurnId, filePath?: string) => void;
}
