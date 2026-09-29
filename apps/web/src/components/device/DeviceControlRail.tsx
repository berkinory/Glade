import {
  DeviceDetachIcon,
  DeviceHomeIcon,
  DevicePowerIcon,
  DeviceRecordIcon,
  DeviceRecordStopIcon,
  DeviceRotateIcon,
  DeviceShutterIcon,
  type LucideIcon,
} from "~/lib/icons";
import { cn } from "~/lib/utils";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

export type DeviceRailAction = "home" | "screenshot" | "record" | "rotate" | "shutdown" | "detach";

interface DeviceRailItem {
  readonly id: DeviceRailAction;
  readonly label: string;
  readonly shortcut?: string;
  readonly Icon: LucideIcon;
}

interface DeviceRailGroup {
  readonly id: string;
  readonly items: readonly DeviceRailItem[];
}

const DEVICE_RAIL_GROUPS: readonly DeviceRailGroup[] = [
  {
    id: "screen",
    items: [
      { id: "home", label: "Home", shortcut: "⌘⇧H", Icon: DeviceHomeIcon },
      { id: "rotate", label: "Rotate view", Icon: DeviceRotateIcon },
    ],
  },
  {
    id: "capture",
    items: [
      { id: "screenshot", label: "Save screenshot", Icon: DeviceShutterIcon },
      { id: "record", label: "Record video", Icon: DeviceRecordIcon },
    ],
  },
  {
    id: "session",
    items: [
      { id: "shutdown", label: "Shut down simulator", Icon: DevicePowerIcon },
      { id: "detach", label: "Detach simulator", Icon: DeviceDetachIcon },
    ],
  },
];

export const DEVICE_RAIL_HEIGHT_CLASS = "h-[2.75rem] shrink-0";

export function DeviceControlRail(props: {
  disabled: boolean;
  recording: boolean;

  landscape: boolean;
  onAction: (action: DeviceRailAction) => void;
}) {
  return (
    <div className={cn("flex items-center justify-center gap-1", DEVICE_RAIL_HEIGHT_CLASS)}>
      {DEVICE_RAIL_GROUPS.map((group, groupIndex) => (
        <div key={group.id} className="flex items-center gap-0.5">
          {groupIndex > 0 ? (
            <span aria-hidden className="mx-1 h-3.5 w-px shrink-0 bg-border" />
          ) : null}
          {group.items.map((item) => {
            const isRecordStop = item.id === "record" && props.recording;
            const Icon = isRecordStop ? DeviceRecordStopIcon : item.Icon;
            const label = isRecordStop ? "Stop recording" : item.label;
            const pressed =
              item.id === "record"
                ? props.recording
                : item.id === "rotate"
                  ? props.landscape
                  : null;

            return (
              <Tooltip key={item.id}>
                <TooltipTrigger
                  render={
                    <button
                      type="button"
                      disabled={props.disabled}
                      aria-label={label}
                      {...(pressed === null ? {} : { "aria-pressed": pressed })}
                      onClick={() => props.onAction(item.id)}
                      className={cn(
                        "flex size-7 cursor-pointer items-center justify-center rounded-md outline-none",
                        "transition-colors duration-120 motion-reduce:transition-none",
                        "hover:bg-[var(--color-background-button-secondary-hover)] hover:text-foreground",
                        "focus-visible:ring-1 focus-visible:ring-ring/60",
                        "disabled:pointer-events-none disabled:opacity-40",

                        isRecordStop
                          ? "bg-destructive/12 text-destructive hover:bg-destructive/20 hover:text-destructive"
                          : pressed
                            ? "bg-[var(--color-background-button-secondary-hover)] text-foreground"
                            : "text-muted-foreground",
                      )}
                    >
                      <Icon className="size-3.5" />
                    </button>
                  }
                />
                <TooltipPopup side="top" sideOffset={6}>
                  {item.shortcut ? `${label}  ${item.shortcut}` : label}
                </TooltipPopup>
              </Tooltip>
            );
          })}
        </div>
      ))}
    </div>
  );
}
