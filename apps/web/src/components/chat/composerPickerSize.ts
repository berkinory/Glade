export type ComposerPickerSize = "small" | "normal";

const COMPOSER_PICKER_SIZE: ComposerPickerSize = "normal";

export function resolveComposerPickerSize(
  size: ComposerPickerSize | undefined,
): ComposerPickerSize {
  return size ?? COMPOSER_PICKER_SIZE;
}

export function composerPickerMenuShellClassName(
  size: ComposerPickerSize | undefined = COMPOSER_PICKER_SIZE,
): string {
  const resolved = resolveComposerPickerSize(size);
  return `composer-picker-menu composer-picker-menu--${resolved}`;
}

export function composerPickerMenuFixedShellClassName(
  size: ComposerPickerSize | undefined = COMPOSER_PICKER_SIZE,
): string {
  return `${composerPickerMenuShellClassName(size)} composer-picker-menu-fixed`;
}
