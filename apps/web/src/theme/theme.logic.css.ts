import {
  normalizeFontFamilyCssValue,
  normalizeMonospaceFontFamilyCssValue,
} from "../lib/fontFamily";
import type { ThemeVariant, ChromeTheme, ThemePack } from "./themeModel";
import {
  BLACK,
  PANEL_BASE_ALPHA,
  PANEL_CONTRAST_STEP,
  WARNING_COLOR_BY_VARIANT,
  WHITE,
} from "./theme.logic.shared";
import type { ResolvedThemeTokens, ThemeCssVariableBuild } from "./theme.logic.shared";
import {
  buildComposerFocusBorder,
  buildSurfaceUnder,
  formatHex,
  formatOpaqueRgb,
  formatRgba,
  mixHex,
  mixRgb,
  normalizeContrastStrength,
  parseHexColor,
} from "./theme.logic.color";

export function buildThemeCssVariables(
  pack: ThemePack,
  variant: ThemeVariant,
  options?: { systemUiFont?: boolean },
): ThemeCssVariableBuild {
  const resolvedTokens = buildResolvedThemeTokens(pack, variant);
  const codexVariables = resolvedTokens.codexVariables;
  const readCodexVariable = (name: string) => getRequiredVariable(codexVariables, name);

  const warningColor = WARNING_COLOR_BY_VARIANT[variant];

  const sidebarSurface = readCodexVariable("--color-background-surface");
  const settingsSurface = readCodexVariable("--color-background-surface");
  const composerSurface =
    variant === "dark"
      ? readCodexVariable("--color-background-control-opaque")
      : "color-mix(in oklab, var(--color-background-control) 90%, transparent)";

  const composerPickerMenuSurface = "color-mix(in oklab, var(--popover) 70%, transparent)";
  const composerFocusBorder = buildComposerFocusBorder(
    pack,
    variant,
    resolvedTokens.computed.panel,
  );

  const chatCodeSurface = readCodexVariable("--color-background-user-message");
  const appVariables: Record<string, string> = {
    "--accent": readCodexVariable("--color-background-accent"),
    "--accent-foreground": readCodexVariable("--color-text-foreground"),
    "--app-shell-background": readCodexVariable("--color-background-surface-under"),

    "--app-composer-focus-border": composerFocusBorder,

    "--app-composer-picker-backdrop-filter": "blur(32px)",
    "--app-composer-picker-surface": composerPickerMenuSurface,
    "--app-chat-code-surface": chatCodeSurface,
    "--app-user-message-background": chatCodeSurface,

    "--app-settings-backdrop-filter": "none",

    "--app-sidebar-surface": sidebarSurface,

    "--app-settings-surface": settingsSurface,
    "--background": readCodexVariable("--color-background-surface-under"),
    "--border": readCodexVariable("--color-border"),
    "--card": readCodexVariable("--color-background-panel"),
    "--card-foreground": readCodexVariable("--color-text-foreground"),
    "--composer-surface": composerSurface,
    "--destructive": pack.theme.semanticColors.diffRemoved,
    "--destructive-foreground": pack.theme.surface,
    "--foreground": readCodexVariable("--color-text-foreground"),
    "--info": pack.theme.accent,

    "--info-foreground": readCodexVariable("--color-text-accent"),
    "--input": readCodexVariable("--color-background-control-opaque"),
    "--muted": readCodexVariable("--color-background-elevated-secondary"),
    "--muted-foreground": readCodexVariable("--color-text-foreground-secondary"),
    "--popover": readCodexVariable("--color-background-elevated-primary-opaque"),
    "--popover-foreground": readCodexVariable("--color-text-foreground"),
    "--primary": readCodexVariable("--color-background-button-primary"),
    "--primary-foreground": readCodexVariable("--color-text-button-primary"),
    "--ring": readCodexVariable("--color-border-focus"),
    "--secondary": readCodexVariable("--color-background-button-secondary"),
    "--secondary-foreground": readCodexVariable("--color-text-button-secondary"),
    "--sidebar": readCodexVariable("--color-background-surface"),
    "--sidebar-accent": readCodexVariable("--color-background-button-secondary-hover"),
    "--sidebar-accent-active": readCodexVariable("--color-background-button-secondary-hover"),

    "--sidebar-selected": chatCodeSurface,
    "--sidebar-accent-foreground": readCodexVariable("--color-text-foreground"),
    "--sidebar-border": readCodexVariable("--color-border"),
    "--sidebar-foreground": readCodexVariable("--color-text-foreground"),
    "--success": pack.theme.semanticColors.diffAdded,
    "--success-foreground": pack.theme.surface,
    "--theme-font-code-family": normalizeMonospaceFontFamilyCssValue(pack.theme.fonts.code) ?? "",

    "--theme-font-ui-family": options?.systemUiFont
      ? ""
      : (normalizeFontFamilyCssValue(pack.theme.fonts.ui) ?? ""),
    "--warning": warningColor,
    "--warning-foreground": pack.theme.surface,
  };

  return {
    variables: {
      ...codexVariables,
      ...resolvedTokens.aliases,
      ...appVariables,
    },
  };
}

function buildResolvedThemeTokens(pack: ThemePack, variant: ThemeVariant): ResolvedThemeTokens {
  const computedTheme = buildComputedTheme(pack.theme, variant);
  const derived =
    variant === "light"
      ? buildLightDerivedTokens(computedTheme)
      : buildDarkDerivedTokens(computedTheme);
  const panel = buildPanelBackground(computedTheme);
  const codexVariables = buildCodexCssVariables(computedTheme, derived, panel);

  return {
    aliases: buildThemeTokenAliases(codexVariables),
    codexVariables,
    computed: {
      contrast: computedTheme.contrast,
      editorBackground: formatOpaqueRgb(computedTheme.editorBackground),
      panel,
      surfaceUnder: computedTheme.surfaceUnder,
    },
    derived,
  };
}

function buildComputedTheme(theme: ChromeTheme, variant: ThemeVariant) {
  const contrast = normalizeContrastStrength(theme.contrast, variant);
  const surface = parseHexColor(theme.surface);
  const ink = parseHexColor(theme.ink);

  return {
    accent: parseHexColor(theme.accent),
    contrast,
    editorBackground:
      variant === "light" ? mixRgb(surface, WHITE, 0.12) : mixRgb(surface, ink, 0.07),
    ink,
    surface,
    surfaceUnder: buildSurfaceUnder(theme, surface, ink, variant),
    theme,
    variant,
  };
}

function buildCodexCssVariables(
  theme: ReturnType<typeof buildComputedTheme>,
  derivedTokens:
    | ReturnType<typeof buildLightDerivedTokens>
    | ReturnType<typeof buildDarkDerivedTokens>,
  panelBackground: string,
) {
  const terminalAnsiGreen = buildTerminalAnsiGreen(theme.theme.semanticColors.diffAdded);

  return {
    "--codex-base-accent": theme.theme.accent,
    "--codex-base-contrast": String(theme.theme.contrast),
    "--codex-base-ink": theme.theme.ink,
    "--codex-base-surface": theme.theme.surface,
    "--color-accent-blue": theme.theme.accent,
    "--color-accent-green": theme.theme.semanticColors.diffAdded,
    "--color-accent-red": theme.theme.semanticColors.diffRemoved,
    "--color-accent-purple": theme.theme.semanticColors.skill,
    "--color-accent-yellow": WARNING_COLOR_BY_VARIANT[theme.variant],
    "--color-background-accent": derivedTokens.accentBackground,
    "--color-background-accent-active": derivedTokens.accentBackgroundActive,
    "--color-background-accent-hover": derivedTokens.accentBackgroundHover,
    "--color-background-button-primary": derivedTokens.buttonPrimaryBackground,
    "--color-background-button-primary-active": derivedTokens.buttonPrimaryBackgroundActive,
    "--color-background-button-primary-hover": derivedTokens.buttonPrimaryBackgroundHover,
    "--color-background-button-primary-inactive": derivedTokens.buttonPrimaryBackgroundInactive,
    "--color-background-button-secondary": derivedTokens.buttonSecondaryBackground,
    "--color-background-button-secondary-active": derivedTokens.buttonSecondaryBackgroundActive,
    "--color-background-button-secondary-hover": derivedTokens.buttonSecondaryBackgroundHover,
    "--color-background-button-secondary-inactive": derivedTokens.buttonSecondaryBackgroundInactive,
    "--color-background-button-tertiary": derivedTokens.buttonTertiaryBackground,
    "--color-background-button-tertiary-active": derivedTokens.buttonTertiaryBackgroundActive,
    "--color-background-button-tertiary-hover": derivedTokens.buttonTertiaryBackgroundHover,
    "--color-background-control": derivedTokens.controlBackground,
    "--color-background-control-opaque": derivedTokens.controlBackgroundOpaque,
    "--color-background-editor-opaque": formatOpaqueRgb(theme.editorBackground),
    "--color-background-elevated-primary": derivedTokens.elevatedPrimary,
    "--color-background-elevated-primary-opaque": derivedTokens.elevatedPrimaryOpaque,
    "--color-background-elevated-secondary": derivedTokens.elevatedSecondary,
    "--color-background-elevated-secondary-opaque": derivedTokens.elevatedSecondaryOpaque,
    "--color-background-panel": panelBackground,
    "--color-background-surface": theme.theme.surface,
    "--color-background-surface-under": theme.surfaceUnder,

    "--color-background-user-message": derivedTokens.buttonSecondaryBackground,
    "--color-border": derivedTokens.border,
    "--color-border-focus": derivedTokens.borderFocus,
    "--color-border-heavy": derivedTokens.borderHeavy,
    "--color-border-light": derivedTokens.borderLight,
    "--color-decoration-added": theme.theme.semanticColors.diffAdded,
    "--color-decoration-deleted": theme.theme.semanticColors.diffRemoved,
    "--color-editor-added": formatRgba(
      parseHexColor(theme.theme.semanticColors.diffAdded),
      theme.variant === "light" ? 0.15 : 0.23,
    ),
    "--color-editor-deleted": formatRgba(
      parseHexColor(theme.theme.semanticColors.diffRemoved),
      theme.variant === "light" ? 0.15 : 0.23,
    ),
    "--color-icon-accent": derivedTokens.iconAccent,
    "--color-icon-primary": derivedTokens.iconPrimary,
    "--color-icon-secondary": derivedTokens.iconSecondary,
    "--color-icon-tertiary": derivedTokens.iconTertiary,
    "--color-simple-scrim": derivedTokens.simpleScrim,
    "--color-text-accent": derivedTokens.textAccent,
    "--color-text-button-primary": derivedTokens.textButtonPrimary,
    "--color-text-button-secondary": derivedTokens.textButtonSecondary,
    "--color-text-button-tertiary": derivedTokens.textButtonTertiary,
    "--color-text-foreground": derivedTokens.textForeground,
    "--color-text-foreground-secondary": derivedTokens.textForegroundSecondary,
    "--color-text-foreground-tertiary": derivedTokens.textForegroundTertiary,
    "--vscode-terminal-ansiBlack": derivedTokens.textForegroundTertiary,
    "--vscode-terminal-ansiBlue": theme.theme.accent,
    "--vscode-terminal-ansiBrightBlack": derivedTokens.textForegroundSecondary,
    "--vscode-terminal-ansiBrightBlue": theme.theme.accent,
    "--vscode-terminal-ansiBrightCyan": theme.theme.accent,
    "--vscode-terminal-ansiBrightGreen": terminalAnsiGreen,
    "--vscode-terminal-ansiBrightMagenta": theme.theme.semanticColors.skill,
    "--vscode-terminal-ansiBrightRed": theme.theme.semanticColors.diffRemoved,
    "--vscode-terminal-ansiBrightWhite": derivedTokens.textForeground,
    "--vscode-terminal-ansiBrightYellow": WARNING_COLOR_BY_VARIANT[theme.variant],
    "--vscode-terminal-ansiCyan": theme.theme.accent,
    "--vscode-terminal-ansiGreen": terminalAnsiGreen,
    "--vscode-terminal-ansiMagenta": theme.theme.semanticColors.skill,
    "--vscode-terminal-ansiRed": theme.theme.semanticColors.diffRemoved,
    "--vscode-terminal-ansiWhite": derivedTokens.textForeground,
    "--vscode-terminal-ansiYellow": WARNING_COLOR_BY_VARIANT[theme.variant],
    "--vscode-terminal-background": theme.theme.surface,
    "--vscode-terminal-border": derivedTokens.border,
    "--vscode-terminal-foreground": derivedTokens.textForeground,
  };
}

function buildTerminalAnsiGreen(diffAddedColor: string): string {
  return mixHex(diffAddedColor, "#000000", 0.18);
}

function buildThemeTokenAliases(codexVariables: Record<string, string>): Record<string, string> {
  const readCodexVariable = (name: string) => getRequiredVariable(codexVariables, name);

  return {
    "--color-token-badge-background": readCodexVariable("--color-background-accent"),
    "--color-token-badge-foreground": readCodexVariable("--color-text-foreground"),
    "--color-token-border": readCodexVariable("--color-border"),
    "--color-token-border-default": readCodexVariable("--color-border"),
    "--color-token-border-heavy": readCodexVariable("--color-border-heavy"),
    "--color-token-border-light": readCodexVariable("--color-border-light"),
    "--color-token-button-background": readCodexVariable("--color-background-button-primary"),
    "--color-token-button-border": readCodexVariable("--color-border"),
    "--color-token-button-foreground": readCodexVariable("--color-text-button-primary"),
    "--color-token-button-secondary-hover-background": readCodexVariable(
      "--color-background-button-secondary-hover",
    ),
    "--color-token-checkbox-active-background": readCodexVariable(
      "--color-background-accent-hover",
    ),
    "--color-token-checkbox-active-foreground": readCodexVariable("--color-text-foreground"),
    "--color-token-description-foreground": readCodexVariable("--color-text-foreground-secondary"),
    "--color-token-disabled-foreground": readCodexVariable("--color-text-foreground-tertiary"),
    "--color-token-dropdown-background": readCodexVariable("--color-background-control-opaque"),
    "--color-token-focus-border": readCodexVariable("--color-border-focus"),
    "--color-token-foreground": readCodexVariable("--color-text-foreground"),
    "--color-token-input-background": readCodexVariable("--color-background-control"),
    "--color-token-input-border": readCodexVariable("--color-border"),
    "--color-token-input-foreground": readCodexVariable("--color-text-foreground"),
    "--color-token-input-placeholder-foreground": readCodexVariable(
      "--color-text-foreground-tertiary",
    ),
    "--color-token-link": readCodexVariable("--color-text-accent"),
    "--color-token-list-active-selection-background": readCodexVariable(
      "--color-background-button-secondary",
    ),
    "--color-token-list-active-selection-foreground": readCodexVariable("--color-text-foreground"),
    "--color-token-list-active-selection-icon-foreground":
      readCodexVariable("--color-icon-primary"),
    "--color-token-list-hover-background": readCodexVariable(
      "--color-background-button-secondary-hover",
    ),
    "--color-token-main-surface-primary": readCodexVariable("--color-background-surface"),
    "--color-token-menu-background": readCodexVariable("--color-background-elevated-primary"),
    "--color-token-menu-border": readCodexVariable("--color-border"),
    "--color-token-progress-bar-background": readCodexVariable("--color-background-accent"),
    "--color-token-radio-active-foreground": readCodexVariable("--color-icon-accent"),
    "--color-token-scrollbar-slider-active-background": readCodexVariable("--color-border-heavy"),
    "--color-token-scrollbar-slider-background": readCodexVariable("--color-border-light"),
    "--color-token-scrollbar-slider-hover-background": readCodexVariable("--color-border"),
    "--color-token-side-bar-background": readCodexVariable("--color-background-surface"),
    "--color-token-terminal-ansi-black": readCodexVariable("--vscode-terminal-ansiBlack"),
    "--color-token-terminal-ansi-blue": readCodexVariable("--vscode-terminal-ansiBlue"),
    "--color-token-terminal-ansi-bright-black": readCodexVariable(
      "--vscode-terminal-ansiBrightBlack",
    ),
    "--color-token-terminal-ansi-bright-blue": readCodexVariable(
      "--vscode-terminal-ansiBrightBlue",
    ),
    "--color-token-terminal-ansi-bright-cyan": readCodexVariable(
      "--vscode-terminal-ansiBrightCyan",
    ),
    "--color-token-terminal-ansi-bright-green": readCodexVariable(
      "--vscode-terminal-ansiBrightGreen",
    ),
    "--color-token-terminal-ansi-bright-magenta": readCodexVariable(
      "--vscode-terminal-ansiBrightMagenta",
    ),
    "--color-token-terminal-ansi-bright-red": readCodexVariable("--vscode-terminal-ansiBrightRed"),
    "--color-token-terminal-ansi-bright-white": readCodexVariable(
      "--vscode-terminal-ansiBrightWhite",
    ),
    "--color-token-terminal-ansi-bright-yellow": readCodexVariable(
      "--vscode-terminal-ansiBrightYellow",
    ),
    "--color-token-terminal-ansi-cyan": readCodexVariable("--vscode-terminal-ansiCyan"),
    "--color-token-terminal-ansi-green": readCodexVariable("--vscode-terminal-ansiGreen"),
    "--color-token-terminal-ansi-magenta": readCodexVariable("--vscode-terminal-ansiMagenta"),
    "--color-token-terminal-ansi-red": readCodexVariable("--vscode-terminal-ansiRed"),
    "--color-token-terminal-ansi-white": readCodexVariable("--vscode-terminal-ansiWhite"),
    "--color-token-terminal-ansi-yellow": readCodexVariable("--vscode-terminal-ansiYellow"),
    "--color-token-terminal-background": readCodexVariable("--vscode-terminal-background"),
    "--color-token-terminal-border": readCodexVariable("--vscode-terminal-border"),
    "--color-token-terminal-foreground": readCodexVariable("--vscode-terminal-foreground"),
    "--color-token-text-code-block-background": readCodexVariable(
      "--color-background-elevated-secondary-opaque",
    ),
    "--color-token-text-link-active-foreground": readCodexVariable("--color-text-accent"),
    "--color-token-text-link-foreground": readCodexVariable("--color-text-accent"),
    "--color-token-text-primary": readCodexVariable("--color-text-foreground"),
    "--color-token-text-secondary": readCodexVariable("--color-text-foreground-secondary"),
    "--color-token-text-tertiary": readCodexVariable("--color-text-foreground-tertiary"),
    "--color-token-toolbar-hover-background": readCodexVariable(
      "--color-background-button-tertiary-hover",
    ),
    "--color-token-editor-background": readCodexVariable("--color-background-editor-opaque"),
    "--color-token-editor-foreground": readCodexVariable("--color-text-foreground"),
  };
}

function getRequiredVariable(variables: Record<string, string>, name: string): string {
  const value = variables[name];
  if (typeof value !== "string") {
    throw new Error(`Missing required theme variable: ${name}`);
  }
  return value;
}

function buildLightDerivedTokens(theme: ReturnType<typeof buildComputedTheme>) {
  const controlBase = mixRgb(theme.surface, WHITE, 0.09 + theme.contrast * 0.04);
  const elevatedSecondaryBase = mixRgb(theme.surface, WHITE, 0.08 + theme.contrast * 0.08);
  const elevatedPrimaryBase = mixRgb(theme.surface, WHITE, 0.16 + theme.contrast * 0.12);

  return {
    accentBackground: mixHex(theme.theme.surface, theme.theme.accent, 0.11 + theme.contrast * 0.04),
    accentBackgroundActive: mixHex(
      theme.theme.surface,
      theme.theme.accent,
      0.13 + theme.contrast * 0.05,
    ),
    accentBackgroundHover: mixHex(
      theme.theme.surface,
      theme.theme.accent,
      0.12 + theme.contrast * 0.045,
    ),

    border: formatRgba(theme.ink, 0.09 + theme.contrast * 0.04),
    borderFocus: theme.theme.accent,
    borderHeavy: formatRgba(theme.ink, 0.09 + theme.contrast * 0.06),
    borderLight: formatRgba(theme.ink, 0.07 + theme.contrast * 0.02),
    buttonPrimaryBackground: theme.theme.ink,
    buttonPrimaryBackgroundActive: formatRgba(theme.ink, 0.1 + theme.contrast * 0.12),
    buttonPrimaryBackgroundHover: formatRgba(theme.ink, 0.05 + theme.contrast * 0.06),
    buttonPrimaryBackgroundInactive: formatRgba(theme.ink, 0.18 + theme.contrast * 0.14),
    buttonSecondaryBackground: formatRgba(theme.ink, 0.03),
    buttonSecondaryBackgroundActive: formatRgba(theme.ink, 0.03 + theme.contrast * 0.02),
    buttonSecondaryBackgroundHover: formatRgba(theme.ink, 0.03),
    buttonSecondaryBackgroundInactive: formatRgba(theme.ink, 0.01 + theme.contrast * 0.02),
    buttonTertiaryBackground: formatRgba(theme.ink, 0),
    buttonTertiaryBackgroundActive: formatRgba(theme.ink, 0.16 + theme.contrast * 0.08),
    buttonTertiaryBackgroundHover: formatRgba(theme.ink, 0.08 + theme.contrast * 0.04),
    controlBackground: formatRgba(controlBase, 0.96),
    controlBackgroundOpaque: formatOpaqueRgb(controlBase),
    elevatedPrimary: formatRgba(elevatedPrimaryBase, 0.96),
    elevatedPrimaryOpaque: formatOpaqueRgb(elevatedPrimaryBase),
    elevatedSecondary: formatRgba(theme.ink, 0.04),
    elevatedSecondaryOpaque: formatOpaqueRgb(elevatedSecondaryBase),
    iconAccent: theme.theme.accent,
    iconPrimary: theme.theme.ink,
    iconSecondary: formatRgba(theme.ink, 0.65 + theme.contrast * 0.1),
    iconTertiary: formatRgba(theme.ink, 0.45 + theme.contrast * 0.1),
    simpleScrim: formatRgba(BLACK, 0.08 + theme.contrast * 0.04),
    textAccent: theme.theme.accent,
    textButtonPrimary: theme.theme.surface,
    textButtonSecondary: theme.theme.ink,
    textButtonTertiary: formatRgba(theme.ink, 0.45 + theme.contrast * 0.1),
    textForeground: theme.theme.ink,
    textForegroundSecondary: formatRgba(theme.ink, 0.65 + theme.contrast * 0.1),
    textForegroundTertiary: formatRgba(theme.ink, 0.45 + theme.contrast * 0.1),
  };
}

function buildDarkDerivedTokens(theme: ReturnType<typeof buildComputedTheme>) {
  const controlBase = mixRgb(theme.surface, theme.ink, 0.06 + theme.contrast * 0.05);
  const focusBase = mixRgb(theme.accent, WHITE, 0.3 + theme.contrast * 0.15);
  const elevatedPrimaryBase = mixRgb(theme.surface, theme.ink, 0.08 + theme.contrast * 0.08);

  return {
    accentBackground: mixHex("#000000", theme.theme.accent, 0.2 + theme.contrast * 0.08),
    accentBackgroundActive: mixHex("#000000", theme.theme.accent, 0.22 + theme.contrast * 0.12),
    accentBackgroundHover: mixHex("#000000", theme.theme.accent, 0.21 + theme.contrast * 0.1),
    border: formatRgba(theme.ink, 0.1 + theme.contrast * 0.04),
    borderFocus: formatRgba(focusBase, 0.7 + theme.contrast * 0.1),
    borderHeavy: formatRgba(theme.ink, 0.16 + theme.contrast * 0.06),
    borderLight: formatRgba(theme.ink, 0.06 + theme.contrast * 0.02),

    buttonPrimaryBackground: theme.theme.ink,
    buttonPrimaryBackgroundActive: formatRgba(theme.ink, 0.07 + theme.contrast * 0.05),
    buttonPrimaryBackgroundHover: formatRgba(theme.ink, 0.04 + theme.contrast * 0.03),
    buttonPrimaryBackgroundInactive: formatRgba(theme.ink, 0.02 + theme.contrast * 0.02),
    buttonSecondaryBackground: formatRgba(theme.ink, 0.04 + theme.contrast * 0.02),
    buttonSecondaryBackgroundActive: formatRgba(theme.ink, 0.09 + theme.contrast * 0.05),
    buttonSecondaryBackgroundHover: formatRgba(theme.ink, 0.06 + theme.contrast * 0.03),
    buttonSecondaryBackgroundInactive: formatRgba(theme.ink, 0.02 + theme.contrast * 0.03),
    buttonTertiaryBackground: formatRgba(theme.ink, 0.02 + theme.contrast * 0.015),
    buttonTertiaryBackgroundActive: formatRgba(theme.ink, 0.07 + theme.contrast * 0.05),
    buttonTertiaryBackgroundHover: formatRgba(theme.ink, 0.05 + theme.contrast * 0.03),
    controlBackground: formatRgba(controlBase, 0.96),
    controlBackgroundOpaque: formatOpaqueRgb(controlBase),
    elevatedPrimary: formatRgba(elevatedPrimaryBase, 0.96),
    elevatedPrimaryOpaque: formatOpaqueRgb(elevatedPrimaryBase),
    elevatedSecondary: formatRgba(theme.ink, 0.02 + theme.contrast * 0.02),
    elevatedSecondaryOpaque: mixHex(
      theme.theme.surface,
      theme.theme.ink,
      0.04 + theme.contrast * 0.05,
    ),
    iconAccent: formatOpaqueRgb(focusBase),
    iconPrimary: formatRgba(theme.ink, 0.82 + theme.contrast * 0.14),
    iconSecondary: formatRgba(theme.ink, 0.65 + theme.contrast * 0.1),
    iconTertiary: formatRgba(theme.ink, 0.45 + theme.contrast * 0.1),
    simpleScrim: formatRgba(theme.ink, 0.08 + theme.contrast * 0.04),

    textAccent: formatOpaqueRgb(focusBase),
    textButtonPrimary: theme.theme.surface,
    textButtonSecondary: mixHex(theme.theme.ink, theme.theme.surface, 0.7 + theme.contrast * 0.1),
    textButtonTertiary: formatRgba(theme.ink, 0.45 + theme.contrast * 0.1),
    textForeground: theme.theme.ink,
    textForegroundSecondary: formatRgba(theme.ink, 0.65 + theme.contrast * 0.1),
    textForegroundTertiary: formatRgba(theme.ink, 0.42 + theme.contrast * 0.13),
  };
}

function buildPanelBackground(theme: ReturnType<typeof buildComputedTheme>): string {
  const anchor = theme.variant === "light" ? WHITE : theme.ink;
  return mixHex(
    theme.theme.surface,
    formatHex(anchor),
    PANEL_BASE_ALPHA[theme.variant] + theme.contrast * PANEL_CONTRAST_STEP[theme.variant],
  );
}
