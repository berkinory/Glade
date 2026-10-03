import type { ReactNode } from "react";
import { SurfaceTabChip } from "./chatHeaderControls";

export interface PanelTab {
  id: string;
  label: string;
  icon: ReactNode;
  leading?: ReactNode;
  trailing?: ReactNode;
  onClose?: (() => void) | undefined;
}

export function PanelTabBar(props: {
  label: string;
  tabs: readonly PanelTab[];
  activeId: string | null;
  onSelect: (id: string) => void;
  actions?: ReactNode;
}) {
  return (
    <div className="flex h-[calc(var(--spacing)*9+1px)] min-w-0 shrink-0 items-center gap-1 border-b border-border/70 bg-[var(--color-background-surface)] px-1.5 py-1">
      <nav
        aria-label={props.label}
        className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {props.tabs.map((tab) => (
          <SurfaceTabChip
            key={tab.id}
            active={tab.id === props.activeId}
            title={tab.label}
            label={tab.label}
            labelClassName="max-w-40"
            icon={tab.icon}
            leading={tab.leading}
            trailing={tab.trailing}
            closeLabel={`Close ${tab.label}`}
            onSelect={() => props.onSelect(tab.id)}
            onClose={tab.onClose}
          />
        ))}
      </nav>
      {props.actions ? <div className="flex shrink-0 items-center">{props.actions}</div> : null}
    </div>
  );
}
