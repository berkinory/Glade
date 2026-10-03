import { useState } from "react";
import type { ThemeFonts } from "~/theme/themeModel";
import { useTheme } from "~/hooks/useTheme";
import { Input } from "../ui/input";
import { Switch } from "../ui/switch";
import { SettingsRow } from "./SettingsPanelPrimitives";

export function ThemeFontSettings() {
  const { activeTheme, systemUiFont, setSystemUiFont, updateThemeFonts } = useTheme();

  const [draft, setDraft] = useState<ThemeFonts>({ ui: null, code: null });

  return (
    <>
      <SettingsRow
        id="setting-use-system-ui-font"
        title="Use system font"
        description="Render the interface with the native system font."
        control={
          <Switch
            checked={systemUiFont}
            onCheckedChange={setSystemUiFont}
            aria-label="Use system font"
          />
        }
      />
      {(["ui", "code"] as const).map((kind) => (
        <SettingsRow
          key={kind}
          title={kind === "ui" ? "UI font" : "Code font"}
          description="Choose a font installed on this device. Leave empty for the default."
          control={
            <Input
              size="sm"
              variant="soft"
              className="w-full sm:w-56"
              value={draft[kind] ?? activeTheme.theme.fonts[kind] ?? ""}
              disabled={kind === "ui" && systemUiFont}
              placeholder={kind === "ui" ? "System default" : "JetBrains Mono"}
              spellCheck={false}
              aria-label={kind === "ui" ? "UI font" : "Code font"}
              onBlur={() => setDraft((previous) => ({ ...previous, [kind]: null }))}
              onChange={(event) => {
                setDraft((previous) => ({ ...previous, [kind]: event.target.value }));
                const value = event.target.value || null;
                updateThemeFonts("dark", { [kind]: value });
                updateThemeFonts("light", { [kind]: value });
              }}
            />
          }
        />
      ))}
    </>
  );
}
