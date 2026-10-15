import { useAppSettings } from "../appSettings";
import { SettingResetButton, SettingsSelectControl } from "../components/settings/SettingControls";
import { SettingsRow, SettingsSection } from "../components/settings/SettingsPanelPrimitives";
import { SelectItem } from "../components/ui/select";
const SIDEBAR_PROJECT_SORT_ORDER_LABELS = {
  updated_at: "Recently active",
  manual: "Manual order",
} as const;
export function SettingsGeneralPanel() {
  const { settings, defaults, updateSettings } = useAppSettings();
  return (
    <div className="space-y-6">
      <SettingsSection title="Sidebar organization">
        <SettingsRow
          id="setting-project-order"
          title="Project order"
          description="Controls how projects are arranged in the main sidebar."
          resetAction={
            settings.sidebarProjectSortOrder !== defaults.sidebarProjectSortOrder ? (
              <SettingResetButton
                label="project order"
                onClick={() =>
                  updateSettings({
                    sidebarProjectSortOrder: defaults.sidebarProjectSortOrder,
                  })
                }
              />
            ) : null
          }
          control={
            <SettingsSelectControl
              value={settings.sidebarProjectSortOrder}
              onValueChange={(value) => {
                if (value !== "updated_at" && value !== "manual") {
                  return;
                }
                updateSettings({
                  sidebarProjectSortOrder: value,
                });
              }}
              ariaLabel="Project sort order"
              valueContent={SIDEBAR_PROJECT_SORT_ORDER_LABELS[settings.sidebarProjectSortOrder]}
            >
              <SelectItem hideIndicator value="updated_at">
                {SIDEBAR_PROJECT_SORT_ORDER_LABELS.updated_at}
              </SelectItem>
              <SelectItem hideIndicator value="manual">
                {SIDEBAR_PROJECT_SORT_ORDER_LABELS.manual}
              </SelectItem>
            </SettingsSelectControl>
          }
        />
      </SettingsSection>
    </div>
  );
}
