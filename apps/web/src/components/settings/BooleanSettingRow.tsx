import type { AppSettings, AppSettingsBinding } from "~/appSettings";
import { Switch } from "../ui/switch";
import { SettingResetButton } from "./SettingControls";
import { SettingsRow } from "./SettingsPanelPrimitives";

export type BooleanSettingKey = {
  [Key in keyof AppSettings]-?: AppSettings[Key] extends boolean ? Key : never;
}[keyof AppSettings];

export function BooleanSettingRow(props: {
  binding: AppSettingsBinding;
  settingKey: BooleanSettingKey;
  title: string;
  description?: string;
  resetLabel: string;
  ariaLabel: string;
}) {
  const { binding, settingKey } = props;
  const { settings, defaults, updateSettings } = binding;
  return (
    <SettingsRow
      id={`setting-${settingKey}`}
      title={props.title}
      description={props.description}
      resetAction={
        settings[settingKey] !== defaults[settingKey] ? (
          <SettingResetButton
            label={props.resetLabel}
            onClick={() =>
              updateSettings({ [settingKey]: defaults[settingKey] } as Partial<AppSettings>)
            }
          />
        ) : null
      }
      control={
        <Switch
          checked={settings[settingKey]}
          onCheckedChange={(checked) =>
            updateSettings({ [settingKey]: Boolean(checked) } as Partial<AppSettings>)
          }
          aria-label={props.ariaLabel}
        />
      }
    />
  );
}
