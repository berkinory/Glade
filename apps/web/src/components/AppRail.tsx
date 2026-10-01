import { type ComponentType, createContext, type ReactNode, useContext } from "react";
import { createPortal } from "react-dom";

import type { RailItemId } from "~/appRail.logic";
import { createCentralIconComponent } from "~/lib/central-icons";
import { projectAppearanceKey, type ProjectAppearance } from "~/lib/projectAppearance";
import { cn } from "~/lib/utils";
import {
  SIDEBAR_ROW_ACTIVE_CLASS_NAME,
  SIDEBAR_ROW_HOVER_CLASS_NAME,
  SIDEBAR_ROW_IDLE_TEXT_CLASS_NAME,
} from "~/sidebarRowStyles";
import { ProjectSidebarIcon } from "./ProjectSidebarIcon";
import type { SidebarActionBadge } from "./Sidebar.logic.statusTypes";
import { SidebarIconButton } from "./SidebarIconButton";

type RailGlyph = ComponentType<{ className?: string }>;

export type AppRailGlyphs = { readonly idle: RailGlyph; readonly active: RailGlyph };

const glyphCache = new Map<string, AppRailGlyphs>();

export function railCentralGlyphs(name: string): AppRailGlyphs {
  const cacheKey = `central:${name}`;
  const cached = glyphCache.get(cacheKey);
  if (cached) return cached;
  const glyphs = {
    idle: createCentralIconComponent(name),
    active: createCentralIconComponent(name, "fill"),
  };
  glyphCache.set(cacheKey, glyphs);
  return glyphs;
}

export function railProjectGlyphs(
  cwd: string,
  appearance: ProjectAppearance | null,
): AppRailGlyphs {
  const cacheKey = `project:${cwd}:${projectAppearanceKey(appearance)}`;
  const cached = glyphCache.get(cacheKey);
  if (cached) return cached;
  function ProjectRailGlyph({ className }: { className?: string }) {
    return (
      <ProjectSidebarIcon
        cwd={cwd}
        expanded={false}
        appearance={appearance}
        {...(className ? { glyphClassName: className } : {})}
      />
    );
  }
  const glyphs = { idle: ProjectRailGlyph, active: ProjectRailGlyph };
  glyphCache.set(cacheKey, glyphs);
  return glyphs;
}

const RAIL_ITEM_GLYPH_NAMES: Record<RailItemId, string> = {
  home: "home-roof-door",
  spaces: "folders",
  settings: "settings-gear-4",
};

export function railItemGlyphs(id: RailItemId): AppRailGlyphs {
  return railCentralGlyphs(RAIL_ITEM_GLYPH_NAMES[id]);
}

export const RAIL_MORE_GLYPHS = railCentralGlyphs("dot-grid-1x3-horizontal");

export type AppRailItem = {
  readonly id: string;
  readonly glyphs: AppRailGlyphs;
  readonly label: string;
  readonly badge: SidebarActionBadge | null;
  readonly active: boolean;
  readonly onSelect: () => void;
  readonly onMouseEnter?: (() => void) | undefined;
  readonly onFocus?: (() => void) | undefined;
};

type AppRailProps = {
  items: ReadonlyArray<AppRailItem>;

  shortcuts: ReadonlyArray<AppRailItem>;

  moreSlot?: ReactNode;
  bottomItems: ReadonlyArray<AppRailItem>;

  bottomSlot?: ReactNode;
};

export const APP_RAIL_GLYPH_CLASS_NAME = "size-5";

export function appRailButtonClassName(active: boolean): string {
  return cn(
    "size-9 rounded-lg",
    active
      ? SIDEBAR_ROW_ACTIVE_CLASS_NAME
      : cn(SIDEBAR_ROW_IDLE_TEXT_CLASS_NAME, SIDEBAR_ROW_HOVER_CLASS_NAME),
  );
}

function AppRailButton({ item }: { item: AppRailItem }) {
  const label = item.badge ? `${item.label} · ${item.badge.accessibleLabel}` : item.label;
  const glyphs = item.glyphs;
  return (
    <div className="relative">
      <SidebarIconButton
        icon={item.active ? glyphs.active : glyphs.idle}
        iconClassName={APP_RAIL_GLYPH_CLASS_NAME}
        label={label}
        size="lg"
        tooltip={label}
        tooltipSide="right"
        aria-current={item.active ? "page" : undefined}
        className={appRailButtonClassName(item.active)}
        onClick={item.onSelect}
        {...(item.onMouseEnter ? { onMouseEnter: item.onMouseEnter } : {})}
        {...(item.onFocus ? { onFocus: item.onFocus } : {})}
      />
      {}
      {item.badge ? (
        <span
          aria-hidden
          className="pointer-events-none absolute top-1 right-1 size-1.5 rounded-full bg-[var(--color-text-accent)]"
        />
      ) : null}
    </div>
  );
}

function AppRail({ items, shortcuts, moreSlot, bottomItems, bottomSlot }: AppRailProps) {
  return (
    <nav
      aria-label="Primary"
      className="flex w-(--app-rail-width) shrink-0 flex-col items-center gap-1.5 pt-2.5 pb-2.5 font-system-ui"
    >
      {items.map((item) => (
        <AppRailButton key={item.id} item={item} />
      ))}
      {shortcuts.length > 0 ? (
        <>
          <div aria-hidden className="my-0.5 h-px w-5 bg-[var(--app-rail-inset-border)]" />
          {shortcuts.map((item) => (
            <AppRailButton key={item.id} item={item} />
          ))}
        </>
      ) : null}
      {moreSlot}
      <div className="mt-auto flex flex-col items-center gap-1.5">
        {bottomSlot}
        {bottomItems.map((item) => (
          <AppRailButton key={item.id} item={item} />
        ))}
      </div>
    </nav>
  );
}

const AppRailSlotContext = createContext<HTMLElement | null>(null);

export const AppRailSlotProvider = AppRailSlotContext.Provider;

export function AppRailPortal(props: AppRailProps) {
  const slot = useContext(AppRailSlotContext);
  return slot ? createPortal(<AppRail {...props} />, slot) : null;
}
