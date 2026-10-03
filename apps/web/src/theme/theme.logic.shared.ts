import { isRecord } from "@glade/shared/transport/payloadValues";
import type {
  ThemeMode,
  ThemeVariant,
  ThemeFonts,
  ChromeTheme,
  ThemePack,
  ThemeState,
  CodeThemeOption,
  ThemeSemanticColors,
} from "./themeModel";
import { THEME_SEED_CATALOG } from "./theme.seed.generated";

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

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

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

export const CODE_THEME_OPTIONS: readonly CodeThemeOption[] = [
  { id: "absolutely", label: "Absolutely", variants: ["light", "dark"] },
  { id: "ayu", label: "Ayu", variants: ["dark"] },
  { id: "catppuccin", label: "Catppuccin", variants: ["light", "dark"] },
  { id: "codex", label: "Codex", variants: ["light", "dark"] },
  { id: "dracula", label: "Dracula", variants: ["dark"] },
  { id: "everforest", label: "Everforest", variants: ["light", "dark"] },
  { id: "github", label: "GitHub", variants: ["light", "dark"] },
  { id: "gruvbox", label: "Gruvbox", variants: ["light", "dark"] },
  { id: "linear", label: "Linear", variants: ["light", "dark"] },
  { id: "material", label: "Material", variants: ["dark"] },
  { id: "monokai", label: "Monokai", variants: ["dark"] },
  { id: "night-owl", label: "Night Owl", variants: ["dark"] },
  { id: "nord", label: "Nord", variants: ["dark"] },
  { id: "one", label: "One", variants: ["light", "dark"] },
  { id: "rose-pine", label: "Rose Pine", variants: ["light", "dark"] },
  { id: "tokyo-night", label: "Tokyo Night", variants: ["dark"] },
  { id: "vesper", label: "Vesper", variants: ["dark"] },
  { id: "vercel", label: "Vercel", variants: ["light", "dark"] },
] as const;

const DEFAULT_CHROME_THEME_BY_VARIANT: Record<ThemeVariant, ChromeTheme> = {
  dark: {
    accent: "#339cff",
    contrast: 0,
    fonts: { code: null, ui: null },
    ink: "#ffffff",
    semanticColors: {
      diffAdded: "#40c977",
      diffRemoved: "#fa423e",
      skill: "#ad7bf9",
    },
    surface: "#181818",
  },
  light: {
    accent: "#339cff",
    contrast: 0,
    fonts: { code: null, ui: null },
    ink: "#1a1c1f",
    semanticColors: {
      diffAdded: "#00a240",
      diffRemoved: "#ba2623",
      skill: "#924ff7",
    },
    surface: "#ffffff",
  },
};

export function isThemeMode(value: unknown): value is ThemeMode {
  return value === "light" || value === "dark" || value === "system";
}

export function getAvailableCodeThemes(variant: ThemeVariant): readonly CodeThemeOption[] {
  return CODE_THEME_OPTIONS.filter((option) => option.variants.includes(variant));
}

function isCodeThemeAvailable(codeThemeId: string, variant: ThemeVariant): boolean {
  const normalizedCodeThemeId = codeThemeId.trim().toLowerCase();
  return CODE_THEME_OPTIONS.some(
    (option) => option.id === normalizedCodeThemeId && option.variants.includes(variant),
  );
}

export function normalizeCodeThemeId(
  codeThemeId: unknown,
  variant: ThemeVariant,
  fallback = DEFAULT_THEME_STATE.codeThemeIds[variant],
): string {
  const normalizedCodeThemeId =
    typeof codeThemeId === "string" ? codeThemeId.trim().toLowerCase() : "";
  return isCodeThemeAvailable(normalizedCodeThemeId, variant) ? normalizedCodeThemeId : fallback;
}

function normalizeThemeFonts(value: unknown): ThemeFonts {
  const fonts = isRecord(value) ? value : {};
  return {
    code: normalizeFontSelection(fonts.code),
    ui: normalizeFontSelection(fonts.ui),
  };
}

function normalizeSemanticColors(
  value: unknown,
  fallback: ThemeSemanticColors,
): ThemeSemanticColors {
  const semanticColors = isRecord(value) ? value : {};
  return {
    diffAdded: normalizeHexColor(semanticColors.diffAdded) ?? fallback.diffAdded,
    diffRemoved: normalizeHexColor(semanticColors.diffRemoved) ?? fallback.diffRemoved,
    skill: normalizeHexColor(semanticColors.skill) ?? fallback.skill,
  };
}

export function normalizeChromeTheme(value: unknown, variant: ThemeVariant): ChromeTheme {
  const fallback = DEFAULT_CHROME_THEME_BY_VARIANT[variant];
  const theme = isRecord(value) ? value : {};

  return {
    accent: normalizeHexColor(theme.accent) ?? fallback.accent,
    contrast: normalizeStoredContrast(theme.contrast, fallback.contrast),
    fonts: normalizeThemeFonts(theme.fonts),
    ink: normalizeHexColor(theme.ink) ?? fallback.ink,
    semanticColors: normalizeSemanticColors(theme.semanticColors, fallback.semanticColors),
    surface: normalizeHexColor(theme.surface) ?? fallback.surface,
  };
}

function normalizeThemePack(value: unknown, variant: ThemeVariant): ThemePack {
  const pack = isRecord(value) ? value : {};
  return {
    codeThemeId: normalizeCodeThemeId(pack.codeThemeId, variant),
    theme: normalizeChromeTheme(pack.theme, variant),
  };
}

function hasStoredCustomUiFont(state: Record<string, unknown>): boolean {
  const chromeThemes = isRecord(state.chromeThemes) ? state.chromeThemes : {};
  const packs = isRecord(state.packs) ? state.packs : {};

  return (["dark", "light"] as const).some((variant) => {
    const chromeTheme = isRecord(chromeThemes[variant]) ? chromeThemes[variant] : {};
    const chromeFonts = isRecord(chromeTheme.fonts) ? chromeTheme.fonts : {};
    if (normalizeFontSelection(chromeFonts.ui) !== null) return true;

    const legacyPack = isRecord(packs[variant]) ? packs[variant] : {};
    const legacyTheme = isRecord(legacyPack.theme) ? legacyPack.theme : {};
    const legacyFonts = isRecord(legacyTheme.fonts) ? legacyTheme.fonts : {};
    return normalizeFontSelection(legacyFonts.ui) !== null;
  });
}

export function normalizeThemeState(value: unknown): ThemeState {
  const state = isRecord(value) ? value : {};
  const codeThemeIds = isRecord(state.codeThemeIds) ? state.codeThemeIds : {};
  const chromeThemes = isRecord(state.chromeThemes) ? state.chromeThemes : {};
  const packs = isRecord(state.packs) ? state.packs : {};
  const legacyDarkPack = normalizeThemePack(packs.dark, "dark");
  const legacyLightPack = normalizeThemePack(packs.light, "light");
  const normalized: ThemeState = {
    chromeThemes: {
      dark: isRecord(chromeThemes.dark)
        ? normalizeChromeTheme(chromeThemes.dark, "dark")
        : isRecord(packs.dark)
          ? legacyDarkPack.theme
          : DEFAULT_THEME_STATE.chromeThemes.dark,
      light: isRecord(chromeThemes.light)
        ? normalizeChromeTheme(chromeThemes.light, "light")
        : isRecord(packs.light)
          ? legacyLightPack.theme
          : DEFAULT_THEME_STATE.chromeThemes.light,
    },
    codeThemeIds: {
      dark: normalizeCodeThemeId(codeThemeIds.dark ?? legacyDarkPack.codeThemeId, "dark"),
      light: normalizeCodeThemeId(codeThemeIds.light ?? legacyLightPack.codeThemeId, "light"),
    },
    mode: isThemeMode(state.mode) ? state.mode : DEFAULT_THEME_STATE.mode,

    systemUiFont:
      typeof state.systemUiFont === "boolean" ? state.systemUiFont : !hasStoredCustomUiFont(state),
  };
  for (const variant of ["dark", "light"] as const) {
    const legacyPack = isRecord(packs[variant]) ? packs[variant] : {};
    const storedId = codeThemeIds[variant] ?? legacyPack.codeThemeId;
    if (typeof storedId === "string" && !isCodeThemeAvailable(storedId, variant)) {
      normalized.chromeThemes[variant] = {
        ...getCodeThemeSeed(normalized.codeThemeIds[variant], variant),
        fonts: normalized.chromeThemes[variant].fonts,
      };
    }
  }
  return normalized;
}

function normalizeStoredContrast(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(100, Math.max(0, Math.round(value)))
    : fallback;
}

function normalizeHexColor(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmedValue = value.trim();
  return HEX_COLOR_RE.test(trimmedValue) ? trimmedValue.toLowerCase() : null;
}

function normalizeFontSelection(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmedValue = value.trim();
  return trimmedValue.length > 0 ? trimmedValue : null;
}

export const DEFAULT_THEME_STATE: ThemeState = {
  chromeThemes: {
    dark: getCodeThemeSeed("codex", "dark"),
    light: getCodeThemeSeed("codex", "light"),
  },
  codeThemeIds: {
    dark: "codex",
    light: "codex",
  },
  systemUiFont: true,
  mode: "system",
};

export function getCodeThemeSeed(codeThemeId: string, variant: ThemeVariant): ChromeTheme {
  const fallback = DEFAULT_CHROME_THEME_BY_VARIANT[variant];
  const themeSeed = THEME_SEED_CATALOG[codeThemeId]?.[variant];
  return themeSeed ? normalizeChromeTheme(themeSeed, variant) : fallback;
}
