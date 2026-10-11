import type { EditorId } from "@glade/contracts/settings/editor";
import type { ResolvedKeybindingsConfig } from "@glade/contracts/settings/keybindings";

import { useEditorLaunchers } from "~/hooks/useEditorLaunchers";

import { ComposerPickerMenuPopup } from "../ComposerPickerMenuPopup";
import { EditorMenuRadioItem } from "../EditorMenuRadioItem";
import { Menu, MenuRadioGroup, MenuTrigger } from "../../ui/menu";
import {
  ENVIRONMENT_ROW_CLASS_NAME,
  ENVIRONMENT_ROW_ICON_CLASS_NAME,
  EnvironmentRowBody,
  EnvironmentLabeledSection,
  EnvironmentRowChevron,
} from "./EnvironmentRow";

export function EnvironmentEditorSection({
  keybindings,
  availableEditors,
  openInTarget,
}: {
  keybindings: ResolvedKeybindingsConfig;
  availableEditors: ReadonlyArray<EditorId>;
  openInTarget: string | null;
}) {
  const {
    options,
    preferredEditor,
    primaryOption,
    openFavoriteShortcutLabel,
    setDefaultEditor,
    openInEditor,
  } = useEditorLaunchers({
    keybindings,
    availableEditors,
    openInTarget,
  });

  if (options.length === 0) {
    return null;
  }

  const activeOption = primaryOption ?? options[0] ?? null;
  const ActiveIcon = activeOption?.Icon;

  return (
    <EnvironmentLabeledSection label="Editor">
      <Menu>
        <MenuTrigger
          disabled={!openInTarget}
          render={<button type="button" className={ENVIRONMENT_ROW_CLASS_NAME} />}
        >
          <EnvironmentRowBody
            icon={
              ActiveIcon ? (
                <ActiveIcon aria-hidden className={ENVIRONMENT_ROW_ICON_CLASS_NAME} />
              ) : null
            }
            label={activeOption ? `Open in ${activeOption.label}` : "Open in editor"}
            trailing={<EnvironmentRowChevron />}
          />
        </MenuTrigger>
        <ComposerPickerMenuPopup align="start" side="bottom" className="w-44 min-w-44">
          <MenuRadioGroup
            value={preferredEditor ?? ""}
            onValueChange={(value) => setDefaultEditor(value as EditorId)}
          >
            {options.map((option) => (
              <EditorMenuRadioItem
                key={option.value}
                option={option}
                shortcutLabel={option.value === preferredEditor ? openFavoriteShortcutLabel : null}
                onOpen={() => openInEditor(option.value)}
              />
            ))}
          </MenuRadioGroup>
        </ComposerPickerMenuPopup>
      </Menu>
    </EnvironmentLabeledSection>
  );
}
