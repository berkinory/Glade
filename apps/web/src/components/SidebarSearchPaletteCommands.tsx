import {
  LaptopIcon,
  FolderPlusIcon,
  Moon02Icon,
  MessageCircleIcon,
  SquarePenIcon,
  SunIcon,
} from "~/lib/icons";
import type { ComponentType } from "react";
type IconComponent = ComponentType<{
  className?: string;
}>;
export const ACTION_ICONS: Record<string, IconComponent> = {
  "new-chat": MessageCircleIcon,
  "new-thread": SquarePenIcon,
  "add-project": FolderPlusIcon,
};
export type ThemeCommandItem = {
  description: string;
  id: string;
  isActive: boolean;
  label: string;
  mode: "system" | "light" | "dark";
};
function queryTokens(query: string): string[] {
  return query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter((token) => token.length > 0);
}
function hasTokenEqual(query: string, token: string): boolean {
  return queryTokens(query).includes(token);
}
function createThemeCommandItem(
  mode: ThemeCommandItem["mode"],
  activeMode: ThemeCommandItem["mode"],
): ThemeCommandItem {
  if (mode === "system") {
    return {
      id: "theme-command:system",
      label: "Switch to system theme",
      description: "Match your OS appearance setting.",
      mode,
      isActive: activeMode === mode,
    };
  }
  return {
    id: `theme-command:${mode}`,
    label: `Switch to ${mode} theme`,
    description: mode === "light" ? "Always use the light theme." : "Always use the dark theme.",
    mode,
    isActive: activeMode === mode,
  };
}
function hasTokenPrefixOf(query: string, keyword: string): boolean {
  return queryTokens(query).some((token) => token.length >= 2 && keyword.startsWith(token));
}
export function buildThemeCommandItems(input: {
  query: string;
  resolvedTheme: "light" | "dark";
  theme: "system" | "light" | "dark";
}): ThemeCommandItem[] {
  const normalizedQuery = input.query.trim().toLowerCase();
  if (!normalizedQuery) {
    return [];
  }
  if (
    hasTokenEqual(normalizedQuery, "system") ||
    hasTokenEqual(normalizedQuery, "auto") ||
    hasTokenEqual(normalizedQuery, "automatic") ||
    hasTokenEqual(normalizedQuery, "os")
  ) {
    return [createThemeCommandItem("system", input.theme)];
  }
  if (hasTokenEqual(normalizedQuery, "light")) {
    return [
      createThemeCommandItem("light", input.theme),
      createThemeCommandItem("system", input.theme),
    ];
  }
  if (hasTokenEqual(normalizedQuery, "dark")) {
    return [
      createThemeCommandItem("dark", input.theme),
      createThemeCommandItem("system", input.theme),
    ];
  }
  if (
    hasTokenPrefixOf(normalizedQuery, "theme") ||
    hasTokenPrefixOf(normalizedQuery, "appearance")
  ) {
    const nextMode = input.resolvedTheme === "dark" ? "light" : "dark";
    return [
      createThemeCommandItem(nextMode, input.theme),
      createThemeCommandItem("system", input.theme),
    ];
  }
  return [];
}
export function CodeThemeBadge(props: { accent: string; background: string; foreground: string }) {
  return (
    <span
      aria-hidden="true"
      className="inline-flex size-6 shrink-0 items-center justify-center rounded-full border font-medium text-ui-xs leading-none tracking-[-0.01em]"
      style={{
        backgroundColor: props.background,
        borderColor: `${props.foreground}26`,
        color: props.accent,
      }}
    >
      Aa
    </span>
  );
}
export const THEME_MODE_ICONS: Record<"system" | "light" | "dark", IconComponent> = {
  system: LaptopIcon,
  light: SunIcon,
  dark: Moon02Icon,
};
