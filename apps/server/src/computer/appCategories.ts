import type { ComputerAccessScope } from "@glade/contracts/computer/computerUse";

// Apps whose category caps what any grant allows. Browsers stay read-only because web work goes
// through Browser Use. Terminals and IDEs run whatever is typed into them, so below a full grant
// they take plain clicks and scrolling only.
export type AppCategory = "browser" | "terminal_or_ide" | "other";

// What an action does to the target app, from least to most powerful.
export type ActionClass = "read" | "click" | "input";

export interface AppIdentity {
  readonly name: string;
  // macOS bundle id; Cua reports the executable or package id elsewhere, when it knows one.
  readonly bundleId: string | null;
  readonly launchPath: string | null;
}

// macOS bundle ids, matched exactly or as a prefix ending in a dot (Chrome channels, JetBrains).
const BUNDLE_IDS: Record<Exclude<AppCategory, "other">, ReadonlyArray<string>> = {
  browser: [
    "com.apple.Safari",
    "com.apple.SafariTechnologyPreview",
    "com.google.Chrome.",
    "com.google.Chrome",
    "org.chromium.Chromium",
    "org.mozilla.firefox",
    "org.mozilla.nightly",
    "org.mozilla.firefoxdeveloperedition",
    "org.torproject.torbrowser",
    "net.imput.helium",
    "com.duckduckgo.macos.browser",
    "ai.perplexity.comet",
    "com.microsoft.edgemac",
    "com.microsoft.edgemac.",
    "company.thebrowser.Browser",
    "company.thebrowser.dia",
    "com.brave.Browser",
    "com.brave.Browser.",
    "com.operasoftware.Opera",
    "com.vivaldi.Vivaldi",
    "app.zen-browser.zen",
    "com.kagi.kagimacOS",
    "com.openai.atlas",
  ],
  terminal_or_ide: [
    "com.apple.Terminal",
    "com.googlecode.iterm2",
    "dev.warp.Warp-Stable",
    "dev.warp.",
    "com.mitchellh.ghostty",
    "net.kovidgoyal.kitty",
    "org.alacritty",
    "com.github.wez.wezterm",
    "co.zeit.hyper",
    "com.microsoft.VSCode",
    "com.microsoft.VSCodeInsiders",
    "com.vscodium",
    "com.todesktop.230313mzl4w4u92",
    "com.exafunction.windsurf",
    "dev.zed.Zed",
    "dev.zed.",
    "com.jetbrains.",
    "com.google.android.studio",
    "com.apple.dt.Xcode",
    "com.sublimetext.4",
    "com.panic.Nova",
    "com.agent.glade",
    "com.agent.glade.",
  ],
};

// Executable base names (lower case, no extension) for Windows and Linux, where Cua names the
// process rather than a bundle.
const EXECUTABLES: Record<Exclude<AppCategory, "other">, ReadonlyArray<string>> = {
  browser: [
    "chrome",
    "google-chrome",
    "google-chrome-stable",
    "chromium",
    "chromium-browser",
    "msedge",
    "microsoft-edge",
    "firefox",
    "brave",
    "brave-browser",
    "opera",
    "vivaldi",
    "zen",
    "arc",
    "helium",
    "comet",
  ],
  terminal_or_ide: [
    "windowsterminal",
    "wt",
    "cmd",
    "powershell",
    "pwsh",
    "conhost",
    "gnome-terminal",
    "gnome-terminal-server",
    "konsole",
    "xterm",
    "alacritty",
    "kitty",
    "wezterm",
    "wezterm-gui",
    "ghostty",
    "warp",
    "tilix",
    "terminator",
    "code",
    "code-insiders",
    "codium",
    "cursor",
    "windsurf",
    "zed",
    "idea",
    "idea64",
    "pycharm",
    "pycharm64",
    "webstorm",
    "webstorm64",
    "goland",
    "goland64",
    "rider",
    "rider64",
    "clion",
    "clion64",
    "studio",
    "studio64",
    "devenv",
    "sublime_text",
    "glade",
  ],
};

const matchesBundle = (bundleId: string, entry: string) =>
  entry.endsWith(".") ? bundleId.startsWith(entry) : bundleId === entry;

const executableName = (path: string) =>
  (path.split(/[\\/]/u).pop() ?? "").toLowerCase().replace(/\.(exe|appimage)$/u, "");

export function appCategory(app: AppIdentity): AppCategory {
  for (const category of ["browser", "terminal_or_ide"] as const) {
    const { bundleId, launchPath } = app;
    if (bundleId && BUNDLE_IDS[category].some((entry) => matchesBundle(bundleId, entry))) {
      return category;
    }
    const executables = EXECUTABLES[category];
    if (bundleId && executables.includes(executableName(bundleId))) return category;
    if (launchPath && executables.includes(executableName(launchPath))) return category;
  }
  return "other";
}

// Why the app's category refuses this action under the given grant, or null when it is allowed.
export function categoryRefusal(
  app: AppIdentity,
  action: ActionClass,
  grantScope: ComputerAccessScope,
): { readonly code: string; readonly message: string } | null {
  if (action === "read") return null;
  const category = appCategory(app);
  if (category === "browser") {
    return {
      code: "browser_read_only",
      message: `${app.name} is a web browser, which Computer Use can only read. Do web work with the browser_* tools in Glade's own browser instead.`,
    };
  }
  if (category === "terminal_or_ide" && action === "input" && grantScope !== "full") {
    return {
      code: "click_only",
      message: `${app.name} is a terminal or code editor: without full control Computer Use may only click and scroll in it, not type, press keys, right-click, drag, use menus or modifier clicks. Run commands with your own shell tools, or ask for full control with computer_request_access.`,
    };
  }
  return null;
}
