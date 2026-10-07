import { ArrowLeft02Icon, SettingsIcon } from "~/lib/icons";
import type { IconComponent } from "~/lib/iconComponent";
import { type KeyboardEvent as ReactKeyboardEvent, useState } from "react";
import { cn } from "~/lib/utils";
import { Badge } from "./ui/badge";
import { SearchInput } from "./ui/search-input";
import { SidebarLeadingIcon } from "./SidebarLeadingIcon";
import { sidebarGlyphClass } from "./sidebarGlyphs";
import {
  SETTINGS_NAV_GROUPS,
  SETTINGS_NAV_ITEMS,
  type SettingsSectionId,
} from "../settingsNavigation";
import {
  rankSettingsSearchEntries,
  settingsSearchEntryTarget,
  settingsSectionLabel,
  type SettingsSearchEntry,
} from "../settingsSearchIndex";
import {
  SETTINGS_SIDEBAR_ITEM_CLASS_NAME,
  SETTINGS_SIDEBAR_ITEM_LABEL_CLASS_NAME,
  SETTINGS_SIDEBAR_LIST_GAP_CLASS_NAME,
  SETTINGS_SIDEBAR_ROW_FILL_ACTIVE_CLASS_NAME,
  SETTINGS_SIDEBAR_ROW_FILL_HOVER_CLASS_NAME,
  SETTINGS_SIDEBAR_SECTION_CLASS_NAME,
  SETTINGS_SIDEBAR_SECTION_LABEL_CLASS_NAME,
} from "../settingsSidebarNavStyles";
const SETTINGS_SEARCH_RESULTS_LIMIT = 12;
const SETTINGS_SECTION_ICON_BY_ID = new Map<SettingsSectionId, IconComponent>(
  SETTINGS_NAV_ITEMS.map((item) => [item.id, item.icon]),
);
function SettingsSearchResultRow(props: {
  entry: SettingsSearchEntry;
  onSelect: (entry: SettingsSearchEntry) => void;
}) {
  const { entry, onSelect } = props;
  const Icon = SETTINGS_SECTION_ICON_BY_ID.get(entry.section) ?? SettingsIcon;
  return (
    <li>
      <button
        type="button"
        className={cn(SETTINGS_SIDEBAR_ITEM_CLASS_NAME, SETTINGS_SIDEBAR_ROW_FILL_HOVER_CLASS_NAME)}
        onClick={() => onSelect(entry)}
      >
        <SidebarLeadingIcon size="sm" tone="text-inherit">
          <Icon className={sidebarGlyphClass("leading")} />
        </SidebarLeadingIcon>
        <span className="min-w-0 text-left">
          <span className="block text-ui">{entry.title}</span>
          <span className="block text-ui-xs text-muted-foreground">
            {settingsSectionLabel(entry.section)}
          </span>
        </span>
      </button>
    </li>
  );
}
export function SettingsSidebarNav(props: {
  activeSection: SettingsSectionId;
  onBack: (() => void) | null;
  onSelectSection: (
    section: SettingsSectionId,
    options?: {
      target?: string;
    },
  ) => void;
}) {
  const { onSelectSection } = props;
  const [query, setQuery] = useState("");
  const trimmedQuery = query.trim();
  const isSearching = trimmedQuery.length > 0;
  const results = rankSettingsSearchEntries(trimmedQuery, SETTINGS_SEARCH_RESULTS_LIMIT);
  const handleSelectResult = (entry: SettingsSearchEntry) => {
    const target = settingsSearchEntryTarget(entry);
    onSelectSection(
      entry.section,
      target
        ? {
            target,
          }
        : undefined,
    );
    setQuery("");
  };
  const handleSearchKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      const topMatch = results[0];
      if (topMatch) {
        handleSelectResult(topMatch);
      }
      return;
    }
    if (event.key === "Escape" && query.length > 0) {
      event.stopPropagation();
      setQuery("");
    }
  };
  return (
    <div className="px-1.5 py-1.5">
      {props.onBack ? (
        <div className="mb-3">
          <button
            type="button"
            className={cn(
              SETTINGS_SIDEBAR_ITEM_CLASS_NAME,
              SETTINGS_SIDEBAR_ROW_FILL_HOVER_CLASS_NAME,
            )}
            onClick={props.onBack}
          >
            <SidebarLeadingIcon size="sm" tone="text-inherit">
              <ArrowLeft02Icon className={sidebarGlyphClass("leading")} />
            </SidebarLeadingIcon>
            <span className={SETTINGS_SIDEBAR_ITEM_LABEL_CLASS_NAME}>Back to app</span>
          </button>
        </div>
      ) : null}

      <div className="mb-3 px-1">
        <SearchInput
          value={query}
          spellCheck={false}
          autoCorrect="off"
          autoCapitalize="off"
          placeholder="Search settings..."
          aria-label="Search settings"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={handleSearchKeyDown}
        />
      </div>

      {isSearching ? (
        results.length === 0 ? (
          <p className={SETTINGS_SIDEBAR_SECTION_LABEL_CLASS_NAME}>No matching settings.</p>
        ) : (
          <ul
            aria-label="Settings search results"
            className={cn("flex flex-col", SETTINGS_SIDEBAR_LIST_GAP_CLASS_NAME)}
          >
            {results.map((entry) => (
              <SettingsSearchResultRow key={entry.id} entry={entry} onSelect={handleSelectResult} />
            ))}
          </ul>
        )
      ) : (
        <nav aria-label="Settings sections" className="flex flex-col">
          {SETTINGS_NAV_GROUPS.map((group) => {
            const items = SETTINGS_NAV_ITEMS.filter((item) => item.group === group.id);
            if (items.length === 0) {
              return null;
            }
            return (
              <section
                key={group.id}
                aria-labelledby={`settings-nav-${group.id}`}
                className={SETTINGS_SIDEBAR_SECTION_CLASS_NAME}
              >
                <h2
                  id={`settings-nav-${group.id}`}
                  className={SETTINGS_SIDEBAR_SECTION_LABEL_CLASS_NAME}
                >
                  {group.label}
                </h2>
                <ul className={cn("flex flex-col", SETTINGS_SIDEBAR_LIST_GAP_CLASS_NAME)}>
                  {items.map((item) => {
                    const isActive = item.id === props.activeSection;
                    return (
                      <li key={item.id}>
                        <button
                          type="button"
                          aria-current={isActive ? "page" : undefined}
                          className={cn(
                            SETTINGS_SIDEBAR_ITEM_CLASS_NAME,
                            isActive
                              ? SETTINGS_SIDEBAR_ROW_FILL_ACTIVE_CLASS_NAME
                              : SETTINGS_SIDEBAR_ROW_FILL_HOVER_CLASS_NAME,
                          )}
                          onClick={() => props.onSelectSection(item.id)}
                        >
                          <SidebarLeadingIcon size="sm" tone="text-inherit">
                            <item.icon className={sidebarGlyphClass("leading")} />
                          </SidebarLeadingIcon>
                          <span className={SETTINGS_SIDEBAR_ITEM_LABEL_CLASS_NAME}>
                            {item.label}
                          </span>
                          {item.badge ? (
                            <Badge
                              variant="outline"
                              size="sm"
                              className="ml-auto rounded-full px-1.5 font-normal text-muted-foreground"
                            >
                              {item.badge}
                            </Badge>
                          ) : null}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </nav>
      )}
    </div>
  );
}
