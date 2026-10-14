export type ThemeMode = "light" | "dark" | "system";
export type ThemeVariant = "light" | "dark";

export interface ThemeFonts {
  ui: string | null;
  code: string | null;
}

interface ThemeSemanticColors {
  diffAdded: string;
  diffRemoved: string;
  skill: string;
}

export interface ChromeTheme {
  accent: string;
  contrast: number;
  fonts: ThemeFonts;
  ink: string;
  semanticColors: ThemeSemanticColors;
  surface: string;
}

export interface ThemeState {
  fonts: Record<ThemeVariant, ThemeFonts>;
  mode: ThemeMode;
  systemUiFont: boolean;
}
