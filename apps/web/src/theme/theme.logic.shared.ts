import { isRecord } from "@glade/shared/transport/payloadValues";
import type { ThemeMode, ThemeVariant, ThemeFonts, ChromeTheme, ThemeState } from "./themeModel";

export interface ThemeCssVariableBuild {
  variables: Record<string, string>;
}

interface ThemeDerivedTokens {
  accentBackground: string;
  accentBackgroundActive: string;
  accentBackgroundHover: string;
  border: string;
  borderFocus: string;
  borderHeavy: string;
  borderLight: string;
  buttonPrimaryBackground: string;
  buttonPrimaryBackgroundActive: string;
  buttonPrimaryBackgroundHover: string;
  buttonPrimaryBackgroundInactive: string;
  buttonSecondaryBackground: string;
  buttonSecondaryBackgroundActive: string;
  buttonSecondaryBackgroundHover: string;
  buttonSecondaryBackgroundInactive: string;
  buttonTertiaryBackground: string;
  buttonTertiaryBackgroundActive: string;
  buttonTertiaryBackgroundHover: string;
  controlBackground: string;
  controlBackgroundOpaque: string;
  elevatedPrimary: string;
  elevatedPrimaryOpaque: string;
  elevatedSecondary: string;
  elevatedSecondaryOpaque: string;
  iconAccent: string;
  iconPrimary: string;
  iconSecondary: string;
  iconTertiary: string;
  simpleScrim: string;
  textAccent: string;
  textButtonPrimary: string;
  textButtonSecondary: string;
  textButtonTertiary: string;
  textForeground: string;
  textForegroundSecondary: string;
  textForegroundTertiary: string;
}

export interface ResolvedThemeTokens {
  aliases: Record<string, string>;
  codexVariables: Record<string, string>;
  computed: {
    contrast: number;
    editorBackground: string;
    panel: string;
    surfaceUnder: string;
  };
  derived: ThemeDerivedTokens;
}

export type RgbColor = {
  red: number;
  green: number;
  blue: number;
};

export const BLACK: RgbColor = { blue: 0, green: 0, red: 0 };

export const WHITE: RgbColor = { blue: 255, green: 255, red: 255 };

export const CONTRAST_CURVE_BELOW_BASELINE = 0.7;

export const CONTRAST_CURVE_ABOVE_BASELINE = 2;

export const CONTRAST_CURVE_BASELINE: Record<ThemeVariant, number> = {
  dark: 60,
  light: 45,
};

export const SURFACE_UNDER_BASE_ALPHA: Record<ThemeVariant, number> = {
  dark: 0.16,
  light: 0.04,
};

export const SURFACE_UNDER_CONTRAST_STEP: Record<ThemeVariant, number> = {
  dark: 0.0015,
  light: 0.0012,
};

export const WARNING_COLOR_BY_VARIANT: Record<ThemeVariant, string> = {
  dark: "#f5b44a",
  light: "#d97706",
};

export const PANEL_BASE_ALPHA: Record<ThemeVariant, number> = {
  dark: 0.03,
  light: 0.18,
};

export const PANEL_CONTRAST_STEP: Record<ThemeVariant, number> = {
  dark: 0.03,
  light: 0.008,
};

export const CHROME_THEME_BY_VARIANT: Record<ThemeVariant, ChromeTheme> = {
  dark: {
    accent: "#0169cc",
    contrast: 0,
    fonts: { code: null, ui: null },
    ink: "#fcfcfc",
    semanticColors: { diffAdded: "#00a240", diffRemoved: "#e02e2a", skill: "#b06dff" },
    surface: "#111111",
  },
  light: {
    accent: "#0169cc",
    contrast: 0,
    fonts: { code: null, ui: null },
    ink: "#242628",
    semanticColors: { diffAdded: "#008534", diffRemoved: "#ba2623", skill: "#751ed9" },
    surface: "#e2e3e5",
  },
};

export function isThemeMode(value: unknown): value is ThemeMode {
  return value === "light" || value === "dark" || value === "system";
}

function normalizeThemeFonts(value: unknown): ThemeFonts {
  const fonts = isRecord(value) ? value : {};
  return {
    code: normalizeFontSelection(fonts.code),
    ui: normalizeFontSelection(fonts.ui),
  };
}

export function normalizeThemeState(value: unknown): ThemeState {
  const state = isRecord(value) ? value : {};
  const storedFonts = isRecord(state.fonts) ? state.fonts : {};
  const chromeThemes = isRecord(state.chromeThemes) ? state.chromeThemes : {};
  const packs = isRecord(state.packs) ? state.packs : {};
  const readFonts = (variant: ThemeVariant): ThemeFonts => {
    if (isRecord(storedFonts[variant])) return normalizeThemeFonts(storedFonts[variant]);
    // Preserve font choices from stored palettes without restoring their colors.
    const chromeTheme = isRecord(chromeThemes[variant]) ? chromeThemes[variant] : {};
    const pack = isRecord(packs[variant]) ? packs[variant] : {};
    const legacyTheme = isRecord(pack.theme) ? pack.theme : {};
    return normalizeThemeFonts(chromeTheme.fonts ?? legacyTheme.fonts);
  };
  const fonts = { dark: readFonts("dark"), light: readFonts("light") };
  return {
    fonts,
    mode: isThemeMode(state.mode) ? state.mode : "system",
    systemUiFont:
      typeof state.systemUiFont === "boolean"
        ? state.systemUiFont
        : fonts.dark.ui === null && fonts.light.ui === null,
  };
}

function normalizeFontSelection(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmedValue = value.trim();
  return trimmedValue.length > 0 ? trimmedValue : null;
}

export const DEFAULT_THEME_STATE: ThemeState = {
  fonts: { dark: { code: null, ui: null }, light: { code: null, ui: null } },
  systemUiFont: true,
  mode: "system",
};
