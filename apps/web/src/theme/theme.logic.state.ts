import type { ThemeMode, ThemeVariant, ThemeFonts, ThemePack, ThemeState } from "./themeModel";
import {
  DEFAULT_THEME_STATE,
  getCodeThemeSeed,
  isThemeMode,
  normalizeChromeTheme,
  normalizeCodeThemeId,
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

export function setThemeCodeThemeId(
  state: ThemeState,
  variant: ThemeVariant,
  codeThemeId: string,
): ThemeState {
  const normalized = normalizeCodeThemeId(codeThemeId, variant);
  const previousTheme = resolveThemePack(state, variant).theme;
  const nextTheme = { ...getCodeThemeSeed(normalized, variant), fonts: previousTheme.fonts };
  return {
    ...state,
    chromeThemes: {
      ...state.chromeThemes,
      [variant]: nextTheme,
    },
    codeThemeIds: {
      ...state.codeThemeIds,
      [variant]: normalized,
    },
  };
}

export function setThemeFonts(
  state: ThemeState,
  variant: ThemeVariant,
  patch: Partial<ThemeFonts>,
): ThemeState {
  const previousTheme = state.chromeThemes[variant];
  return {
    ...state,
    chromeThemes: {
      ...state.chromeThemes,
      [variant]: normalizeChromeTheme(
        {
          ...previousTheme,
          fonts: { ...previousTheme.fonts, ...patch },
        },
        variant,
      ),
    },
  };
}

export function resolveThemePack(state: ThemeState, variant: ThemeVariant): ThemePack {
  return {
    codeThemeId: normalizeCodeThemeId(state.codeThemeIds[variant], variant),
    theme: normalizeChromeTheme(state.chromeThemes[variant], variant),
  };
}

export function resolveThemeVariant(mode: ThemeMode, systemDark: boolean): ThemeVariant {
  if (mode === "system") {
    return systemDark ? "dark" : "light";
  }
  return mode;
}
