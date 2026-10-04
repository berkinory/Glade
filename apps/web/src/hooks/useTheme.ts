import { useEffect, useSyncExternalStore } from "react";
import { initializeDesktopWindowMaterial } from "./useDesktopWindowMaterial";
import { DEFAULT_THEME_STATE } from "../theme/theme.logic.shared";
import {
  parseStoredThemeState,
  resolveThemePack,
  resolveThemeVariant,
  serializeThemeState,
  setThemeCodeThemeId,
  setThemeFonts,
} from "../theme/theme.logic.state";
import { buildThemeCssVariables } from "../theme/theme.logic.css";
import {
  type ThemeFonts,
  type ThemeMode,
  type ThemeState,
  type ThemeVariant,
} from "../theme/themeModel";

type ThemeSnapshot = {
  state: ThemeState;
  systemDark: boolean;
};

const STORAGE_KEY = "glade:theme";
const MEDIA_QUERY = "(prefers-color-scheme: dark)";

let listeners: Array<() => void> = [];

let currentSnapshot: ThemeSnapshot | null = null;
let lastDesktopTheme: ThemeMode | null = null;

function emitChange() {
  refreshSnapshot();
  for (const listener of listeners) {
    listener();
  }
}

function hasThemeStorage(): boolean {
  return typeof window !== "undefined" && typeof localStorage !== "undefined";
}

function getSystemDark(): boolean {
  return typeof window !== "undefined" && window.matchMedia(MEDIA_QUERY).matches;
}

function readStoredThemeState(): ThemeState {
  if (!hasThemeStorage()) {
    return DEFAULT_THEME_STATE;
  }

  try {
    return parseStoredThemeState(localStorage.getItem(STORAGE_KEY));
  } catch {
    return DEFAULT_THEME_STATE;
  }
}

function writeStoredThemeState(state: ThemeState) {
  if (!hasThemeStorage()) {
    return;
  }

  localStorage.setItem(STORAGE_KEY, serializeThemeState(state));
}

function computeSnapshot(): ThemeSnapshot {
  const state = readStoredThemeState();
  const systemDark = state.mode === "system" ? getSystemDark() : false;
  return { state, systemDark };
}

function refreshSnapshot(): ThemeSnapshot {
  const next = computeSnapshot();

  if (
    currentSnapshot &&
    currentSnapshot.systemDark === next.systemDark &&
    serializeThemeState(currentSnapshot.state) === serializeThemeState(next.state)
  ) {
    return currentSnapshot;
  }
  currentSnapshot = next;
  return next;
}

function getSnapshot(): ThemeSnapshot {
  return currentSnapshot ?? refreshSnapshot();
}

function updateStoredThemeState(update: (state: ThemeState) => ThemeState) {
  const nextState = update(readStoredThemeState());
  writeStoredThemeState(nextState);
  applyThemeState(nextState, true);
  emitChange();
}

function subscribe(listener: () => void): () => void {
  if (typeof window === "undefined") {
    return () => {};
  }

  listeners.push(listener);

  const mediaQuery = window.matchMedia(MEDIA_QUERY);
  const handleMediaChange = () => {
    const state = readStoredThemeState();
    if (state.mode === "system") {
      applyThemeState(state, true);
    }
    emitChange();
  };
  const handleStorage = (event: StorageEvent) => {
    if (event.key !== STORAGE_KEY) {
      return;
    }
    applyThemeState(readStoredThemeState(), true);
    emitChange();
  };

  mediaQuery.addEventListener("change", handleMediaChange);
  window.addEventListener("storage", handleStorage);

  return () => {
    listeners = listeners.filter((currentListener) => currentListener !== listener);
    mediaQuery.removeEventListener("change", handleMediaChange);
    window.removeEventListener("storage", handleStorage);
  };
}

function applyThemeState(state: ThemeState, suppressTransitions = false) {
  if (typeof document === "undefined" || typeof window === "undefined") {
    return;
  }

  const root = document.documentElement;

  if (
    typeof root.classList?.toggle !== "function" ||
    typeof root.style?.setProperty !== "function" ||
    typeof root.style?.removeProperty !== "function"
  ) {
    return;
  }

  if (suppressTransitions) {
    root.classList.add("no-transitions");
  }

  const variant = resolveThemeVariant(state.mode, getSystemDark());
  const activeTheme = resolveThemePack(state, variant);
  const cssVariableBuild = buildThemeCssVariables(activeTheme, variant, {
    systemUiFont: state.systemUiFont,
  });

  root.classList.toggle("dark", variant === "dark");
  root.setAttribute("data-code-theme-id", activeTheme.codeThemeId);
  root.setAttribute("data-theme-mode", state.mode);
  root.setAttribute("data-theme-variant", variant);

  for (const [name, value] of Object.entries(cssVariableBuild.variables)) {
    if (value.trim().length === 0) {
      root.style.removeProperty(name);
      continue;
    }
    root.style.setProperty(name, value);
  }

  syncDesktopTheme(state.mode);

  if (suppressTransitions) {
    // Force a reflow so the no-transitions class takes effect before removal.
    // oxlint-disable-next-line no-unused-expressions
    root.offsetHeight;
    requestAnimationFrame(() => {
      root.classList.remove("no-transitions");
    });
  }
}

function syncDesktopTheme(theme: ThemeMode) {
  if (typeof window === "undefined") {
    return;
  }

  const bridge = window.desktopBridge;
  if (!bridge || lastDesktopTheme === theme) {
    return;
  }

  lastDesktopTheme = theme;
  void bridge.setTheme(theme).catch(() => {
    if (lastDesktopTheme === theme) {
      lastDesktopTheme = null;
    }
  });
}

if (typeof document !== "undefined") {
  applyThemeState(readStoredThemeState());
  initializeDesktopWindowMaterial();
}

function setTheme(nextTheme: ThemeMode) {
  updateStoredThemeState((state) => ({
    ...state,
    mode: nextTheme,
  }));
}

function setSystemUiFont(enabled: boolean) {
  updateStoredThemeState((state) => ({
    ...state,
    systemUiFont: enabled,
  }));
}

function resetAllThemes() {
  updateStoredThemeState(() => DEFAULT_THEME_STATE);
}

function updateThemeFonts(variant: ThemeVariant, patch: Partial<ThemeFonts>) {
  updateStoredThemeState((state) => setThemeFonts(state, variant, patch));
}

function setCodeThemeId(variant: ThemeVariant, codeThemeId: string) {
  updateStoredThemeState((state) => setThemeCodeThemeId(state, variant, codeThemeId));
}

export function useTheme() {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, () => ({
    state: DEFAULT_THEME_STATE,
    systemDark: false,
  }));
  const theme = snapshot.state.mode;
  const resolvedTheme = resolveThemeVariant(theme, snapshot.systemDark);
  const activeTheme = resolveThemePack(snapshot.state, resolvedTheme);
  const darkTheme = resolveThemePack(snapshot.state, "dark");
  const lightTheme = resolveThemePack(snapshot.state, "light");
  useEffect(() => {
    applyThemeState(snapshot.state);
  }, [snapshot.state]);

  return {
    activeTheme,
    systemUiFont: snapshot.state.systemUiFont,
    setSystemUiFont,
    darkTheme,
    lightTheme,
    resetAllThemes,
    resolvedTheme,
    setCodeThemeId,
    setTheme,
    theme,
    themeState: snapshot.state,
    updateThemeFonts,
  } as const;
}

export type { ThemeMode, ThemeState, ThemeVariant };
