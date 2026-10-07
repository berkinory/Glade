import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { SettingsRow } from "../settings/SettingsPanelPrimitives";
import { Switch } from "../ui/switch";

const QUERY_KEY = ["browser-content-blocker"];

export function BrowserContentBlockerRow() {
  const bridge = window.desktopBridge?.browser?.contentBlocker;
  const queryClient = useQueryClient();
  const enabled = useQuery({
    queryKey: QUERY_KEY,
    queryFn: () => bridge!.getEnabled(),
    enabled: bridge !== undefined,
    retry: false,
  });
  const [error, setError] = useState<string | null>(null);
  if (!bridge) return null;

  async function change(next: boolean): Promise<void> {
    setError(null);
    try {
      queryClient.setQueryData(QUERY_KEY, await bridge!.setEnabled(next));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  return (
    <SettingsRow
      id="setting-browser-content-blocker"
      title="Block ads, trackers and cookie notices"
      description="Applies to Glade's built-in browser, for you and the agent. Filter lists refresh daily; pages pick up a change on their next load."
      status={error ?? (enabled.error instanceof Error ? enabled.error.message : undefined)}
      control={
        <Switch
          checked={enabled.data ?? true}
          disabled={enabled.data === undefined}
          onCheckedChange={(next) => void change(Boolean(next))}
          aria-label="Block ads, trackers and cookie notices"
        />
      }
    />
  );
}
