import type { ComponentProps } from "react";

import { cn } from "~/lib/utils";
import { MenuPopupBase, MenuSubPopup } from "../ui/menu";
import { SelectPopup } from "../ui/select";
import {
  type ComposerPickerSize,
  composerPickerMenuFixedShellClassName,
  composerPickerMenuShellClassName,
  resolveComposerPickerSize,
} from "./composerPickerSize";

type ComposerPickerMenuPopupProps = Omit<ComponentProps<typeof MenuPopupBase>, "surface"> & {
  size?: ComposerPickerSize;

  fixedWidth?: boolean;
};

export function ComposerPickerMenuPopup({
  className,
  size,
  fixedWidth: fixedWidthProp,
  ...props
}: ComposerPickerMenuPopupProps) {
  const fixedWidth = fixedWidthProp ?? false;
  const resolvedSize = resolveComposerPickerSize(size);
  return (
    <MenuPopupBase
      surface="composer"
      pickerSize={resolvedSize}
      className={cn(
        fixedWidth
          ? composerPickerMenuFixedShellClassName(resolvedSize)
          : composerPickerMenuShellClassName(resolvedSize),
        className,
      )}
      {...props}
    />
  );
}

type ComposerPickerSelectPopupProps = Omit<ComponentProps<typeof SelectPopup>, "surface"> & {
  size?: ComposerPickerSize;
};

export function ComposerPickerSelectPopup({
  align: alignProp,
  alignItemWithTrigger: alignItemWithTriggerProp,
  size,
  className,
  ...props
}: ComposerPickerSelectPopupProps) {
  const align = alignProp ?? "end";
  const alignItemWithTrigger = alignItemWithTriggerProp ?? false;
  const resolvedSize = resolveComposerPickerSize(size);
  return (
    <SelectPopup
      align={align}
      alignItemWithTrigger={alignItemWithTrigger}
      surface="composer"
      shellClassName={composerPickerMenuShellClassName(resolvedSize)}
      className={className}
      {...props}
    />
  );
}

type ComposerPickerMenuSubPopupProps = Omit<ComponentProps<typeof MenuSubPopup>, "surface"> & {
  size?: ComposerPickerSize;

  fixedWidth?: boolean;
};

export function ComposerPickerMenuSubPopup({
  className,
  size,
  fixedWidth: fixedWidthProp,
  ...props
}: ComposerPickerMenuSubPopupProps) {
  const fixedWidth = fixedWidthProp ?? false;
  const resolvedSize = resolveComposerPickerSize(size);
  return (
    <MenuSubPopup
      surface="composer"
      pickerSize={resolvedSize}
      className={cn(
        fixedWidth
          ? composerPickerMenuFixedShellClassName(resolvedSize)
          : composerPickerMenuShellClassName(resolvedSize),
        className,
      )}
      {...props}
    />
  );
}
