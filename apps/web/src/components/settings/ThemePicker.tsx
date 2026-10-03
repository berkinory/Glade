import { useTheme } from "~/hooks/useTheme";
import { getAvailableCodeThemes, getCodeThemeSeed } from "~/theme/theme.logic.shared";
import { Select, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { SettingsSelectPopup } from "./SettingsPanelPrimitives";

export function ThemePicker() {
  const { activeTheme, resolvedTheme, setCodeThemeId } = useTheme();
  const options = getAvailableCodeThemes(resolvedTheme);
  const selected = options.find((option) => option.id === activeTheme.codeThemeId)!;

  return (
    <Select
      value={activeTheme.codeThemeId}
      onValueChange={(value) => {
        if (typeof value === "string") setCodeThemeId(resolvedTheme, value);
      }}
    >
      <SelectTrigger size="sm" className="min-w-52" aria-label="Theme">
        <SelectValue>{selected.label}</SelectValue>
      </SelectTrigger>
      <SettingsSelectPopup>
        {options.map((option) => {
          const seed = getCodeThemeSeed(option.id, resolvedTheme);
          return (
            <SelectItem key={option.id} value={option.id}>
              <span className="flex items-center gap-3 py-0.5">
                <span
                  aria-hidden
                  className="block size-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: seed.accent }}
                />
                <span>{option.label}</span>
              </span>
            </SelectItem>
          );
        })}
      </SettingsSelectPopup>
    </Select>
  );
}
