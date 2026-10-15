import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";

export type SettingsStatusTone = "checking" | "off" | "granted" | "needed" | "blocked";

export interface SettingsStatusAction {
  readonly label: string;
  readonly run: () => void;
}

const TONE_DOT_CLASS_NAME: Record<SettingsStatusTone, string> = {
  checking: "bg-muted-foreground/45 animate-pulse",
  off: "bg-muted-foreground/45",
  granted: "bg-success",
  needed: "bg-warning",
  blocked: "bg-destructive",
};

// The one presentation for a setting's live state (an OS permission, a sign-in, a provider's health):
// this fixed-height line under the description carries the state, and the row's control area holds at
// most one SettingsStatusButton followed by the setting's own control.
export function SettingsStatus(props: {
  readonly tone: SettingsStatusTone;
  readonly label: string;
}) {
  const { tone, label } = props;
  return (
    <span
      className="flex min-h-5 items-center gap-1.5"
      role={tone === "blocked" ? "alert" : undefined}
    >
      <span
        aria-hidden
        className={cn("size-1.5 shrink-0 rounded-full", TONE_DOT_CLASS_NAME[tone])}
      />
      <span className="min-w-0 truncate">{label}</span>
    </span>
  );
}

export function SettingsStatusButton(props: {
  readonly action: SettingsStatusAction;
  readonly disabled?: boolean;
}) {
  return (
    <Button size="sm" variant="outline" disabled={props.disabled} onClick={props.action.run}>
      {props.action.label}
    </Button>
  );
}
