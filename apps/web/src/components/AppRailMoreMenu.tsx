import { ComposerPickerMenuPopup } from "./chat/ComposerPickerMenuPopup";
import { APP_RAIL_GLYPH_CLASS_NAME, appRailButtonClassName, RAIL_MORE_GLYPHS } from "./AppRail";
import { SidebarIconButton } from "./SidebarIconButton";
import {
  Menu,
  MenuCheckboxItem,
  MenuGroup,
  MenuGroupLabel,
  MenuSeparator,
  MenuTrigger,
} from "./ui/menu";

export type AppRailMoreMenuEntry = {
  readonly key: string;
  readonly label: string;
};

export function AppRailMoreMenu({
  spaces,
  projects,
  pinnedKeys,
  onToggleShortcut,
  active,
}: {
  readonly spaces: ReadonlyArray<AppRailMoreMenuEntry>;
  readonly projects: ReadonlyArray<AppRailMoreMenuEntry>;
  readonly pinnedKeys: ReadonlySet<string>;
  readonly onToggleShortcut: (key: string) => void;
  readonly active: boolean;
}) {
  return (
    <Menu>
      <SidebarIconButton
        render={<MenuTrigger />}
        icon={active ? RAIL_MORE_GLYPHS.active : RAIL_MORE_GLYPHS.idle}
        iconClassName={APP_RAIL_GLYPH_CLASS_NAME}
        label="More"
        tooltip="More"
        tooltipSide="right"
        aria-current={active ? "page" : undefined}
        className={appRailButtonClassName(active)}
      />
      <ComposerPickerMenuPopup
        align="start"
        side="right"
        className="max-h-[min(36rem,80vh)] w-64 min-w-64 overflow-y-auto"
      >
        <MenuGroup>
          <MenuGroupLabel>Spaces in the rail</MenuGroupLabel>
          {spaces.map((entry) => (
            <MenuCheckboxItem
              key={entry.key}
              checked={pinnedKeys.has(entry.key)}
              onCheckedChange={() => onToggleShortcut(entry.key)}
            >
              <span className="min-w-0 truncate">{entry.label}</span>
            </MenuCheckboxItem>
          ))}
        </MenuGroup>
        <MenuSeparator />
        <MenuGroup>
          <MenuGroupLabel>Projects in the rail</MenuGroupLabel>
          {projects.length === 0 ? (
            <div className="px-2.5 py-1 text-ui text-muted-foreground">No projects yet</div>
          ) : (
            projects.map((entry) => (
              <MenuCheckboxItem
                key={entry.key}
                checked={pinnedKeys.has(entry.key)}
                onCheckedChange={() => onToggleShortcut(entry.key)}
              >
                <span className="min-w-0 truncate">{entry.label}</span>
              </MenuCheckboxItem>
            ))
          )}
        </MenuGroup>
      </ComposerPickerMenuPopup>
    </Menu>
  );
}
