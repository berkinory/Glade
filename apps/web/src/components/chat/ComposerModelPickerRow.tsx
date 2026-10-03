import { type ProviderModelDescriptor } from "@glade/contracts/provider/providerDiscovery";

import { type StarredModel, starredModelSlotKey } from "~/lib/starredModels";
import { cn } from "~/lib/utils";
import { type ProviderOptions } from "../../providerModelOptions";
import { PROVIDER_ICON_COMPONENT_BY_PROVIDER } from "../ProviderIcon";
import { ShortcutKbd } from "../ui/shortcut-kbd";
import { MenuItem } from "../ui/menu";
import {
  type ComposerModelPickerRow as PickerRow,
  resolveStarredTraits,
} from "./ComposerModelPicker.logic";
import { COMPOSER_MUTED_ACCENT_TEXT_CLASS_NAME } from "./composerPickerStyles";
import { getComposerTraitSelection } from "./composerTraits";
import { ModelStarButton } from "./ModelStarButton";
import { PICKER_PANEL_ROW_SELECTED_CLASS_NAME } from "./pickerPanelStyles";
import { getProviderIconClassName } from "./ProviderModelPicker";
import { resolveRuntimeModelDescriptor } from "./runtimeModelCapabilities";

export function ComposerModelPickerRow(props: {
  row: PickerRow;

  shortcutHint: string | null;

  providerOptions: ProviderOptions | undefined;
  runtimeModels: ReadonlyArray<ProviderModelDescriptor> | null | undefined;
  prompt: string;

  starredModelSlots: ReadonlySet<string>;
  onSelect: (row: PickerRow) => void;

  onToggleStar: (entry: StarredModel) => void;
  onUnstarModel: (entry: Pick<StarredModel, "provider" | "model">) => void;
}) {
  const { row } = props;
  const selection = getComposerTraitSelection(
    row.provider,
    row.model,
    props.prompt,
    props.providerOptions,
    resolveRuntimeModelDescriptor({
      provider: row.provider,
      model: row.model,
      runtimeModels: props.runtimeModels,
    }),
  );
  const starEntry: StarredModel = row.preset ?? {
    provider: row.provider,
    model: row.model,
    ...resolveStarredTraits(selection, props.providerOptions),
  };

  const starred = row.preset !== null || props.starredModelSlots.has(starredModelSlotKey(row));

  const RowProviderIcon = PROVIDER_ICON_COMPONENT_BY_PROVIDER[row.provider];
  const rowClassName = cn("pe-1", row.selected && PICKER_PANEL_ROW_SELECTED_CLASS_NAME);
  const starButton = (
    <ModelStarButton
      starred={starred}
      iconClassName="size-3.5"
      label={
        starred
          ? `Remove ${row.name} from starred`
          : `Star ${row.name} with its current effort and speed`
      }
      onToggle={() =>
        row.preset === null && starred ? props.onUnstarModel(row) : props.onToggleStar(starEntry)
      }
    />
  );

  const rowContent = (
    <>
      {row.preset ? (
        <RowProviderIcon
          aria-hidden="true"
          className={cn("size-3.5 shrink-0", getProviderIconClassName(row.provider))}
        />
      ) : null}
      <span className={cn("truncate", row.detail !== null && "max-w-[62%] shrink-0")}>
        {row.name}
      </span>
      <span className={cn("min-w-0 flex-1 truncate", COMPOSER_MUTED_ACCENT_TEXT_CLASS_NAME)}>
        {row.detail}
      </span>
      {props.shortcutHint ? (
        <ShortcutKbd
          shortcutLabel={props.shortcutHint}
          className="shrink-0 text-muted-foreground"
        />
      ) : null}
      {row.selectableModel !== null ? starButton : null}
    </>
  );

  if (row.selectableModel === null) {
    return (
      <div className="relative">
        <MenuItem disabled className="pe-8" closeOnClick={false}>
          {rowContent}
        </MenuItem>
        <div className="absolute inset-y-0 end-1 flex items-center">{starButton}</div>
      </div>
    );
  }

  return (
    <MenuItem
      aria-current={row.selected ? "true" : undefined}
      className={rowClassName}
      closeOnClick={false}
      onClick={() => props.onSelect(row)}
    >
      {rowContent}
    </MenuItem>
  );
}
