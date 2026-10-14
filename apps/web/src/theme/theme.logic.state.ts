import type { ThemeMode, ThemeVariant, ThemeFonts, ChromeTheme, ThemeState } from "./themeModel";
import {
  DEFAULT_THEME_STATE,
  CHROME_THEME_BY_VARIANT,
  isThemeMode,
  normalizeThemeState,
} from "./theme.logic.shared";

export function parseStoredThemeState(rawValue: string | null | undefined): ThemeState {
  if (!rawValue) {
    return DEFAULT_THEME_STATE;
  }
  if (isThemeMode(rawValue)) {
    return {
      ...DEFAULT_THEME_STATE,
      mode: rawValue,
    };
  }

  try {
    return normalizeThemeState(JSON.parse(rawValue));
  } catch {
    return DEFAULT_THEME_STATE;
  }
}

export function serializeThemeState(state: ThemeState): string {
  return JSON.stringify(state);
}

export function setThemeFonts(
  state: ThemeState,
  variant: ThemeVariant,
  patch: Partial<ThemeFonts>,
): ThemeState {
  return {
    ...state,
    fonts: { ...state.fonts, [variant]: { ...state.fonts[variant], ...patch } },
  };
}

export function resolveTheme(state: ThemeState, variant: ThemeVariant): ChromeTheme {
  return { ...CHROME_THEME_BY_VARIANT[variant], fonts: state.fonts[variant] };
}

export function resolveThemeVariant(mode: ThemeMode, systemDark: boolean): ThemeVariant {
  if (mode === "system") {
    return systemDark ? "dark" : "light";
  }
  return mode;
}
