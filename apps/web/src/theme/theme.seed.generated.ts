import type { ChromeTheme, ThemeVariant } from "./themeModel";

export const THEME_SEED_CATALOG: Record<string, Partial<Record<ThemeVariant, ChromeTheme>>> = {
  absolutely: {
    dark: {
      accent: "#cc7d5e",
      contrast: 0,
      fonts: {
        code: null,
        ui: null,
      },
      ink: "#f9f9f7",
      semanticColors: {
        diffAdded: "#00c853",
        diffRemoved: "#ff5f38",
        skill: "#cc7d5e",
      },
      surface: "#2d2d2b",
    },
    light: {
      accent: "#cc7d5e",
      contrast: 0,
      fonts: {
        code: null,
        ui: null,
      },
      ink: "#2d2d2b",
      semanticColors: {
        diffAdded: "#00c853",
        diffRemoved: "#ff5f38",
        skill: "#cc7d5e",
      },
      surface: "#f9f9f7",
    },
  },
  ayu: {
    dark: {
      accent: "#e6b450",
      contrast: 0,
      fonts: {
        code: null,
        ui: null,
      },
      ink: "#bfbdb6",
      semanticColors: {
        diffAdded: "#7fd962",
        diffRemoved: "#ea6c73",
        skill: "#cda1fa",
      },
      surface: "#0b0e14",
    },
  },
  catppuccin: {
    dark: {
      accent: "#cba6f7",
      contrast: 0,
      fonts: {
        code: null,
        ui: null,
      },
      ink: "#cdd6f4",
      semanticColors: {
        diffAdded: "#a6e3a1",
        diffRemoved: "#f38ba8",
        skill: "#cba6f7",
      },
      surface: "#1e1e2e",
    },
    light: {
      accent: "#8839ef",
      contrast: 0,
      fonts: {
        code: null,
        ui: null,
      },
      ink: "#4c4f69",
      semanticColors: {
        diffAdded: "#40a02b",
        diffRemoved: "#d20f39",
        skill: "#8839ef",
      },
      surface: "#eff1f5",
    },
  },
  codex: {
    dark: {
      accent: "#0169cc",
      contrast: 0,
      fonts: {
        code: null,
        ui: null,
      },
      ink: "#fcfcfc",
      semanticColors: {
        diffAdded: "#00a240",
        diffRemoved: "#e02e2a",
        skill: "#b06dff",
      },
      surface: "#111111",
    },
    light: {
      accent: "#0169cc",
      contrast: 0,
      fonts: {
        code: null,
        ui: null,
      },
      ink: "#0d0d0d",
      semanticColors: {
        diffAdded: "#00a240",
        diffRemoved: "#e02e2a",
        skill: "#751ed9",
      },
      surface: "#ffffff",
    },
  },
  dracula: {
    dark: {
      accent: "#ff79c6",
      contrast: 0,
      fonts: {
        code: null,
        ui: null,
      },
      ink: "#f8f8f2",
      semanticColors: {
        diffAdded: "#50fa7b",
        diffRemoved: "#ff5555",
        skill: "#ff79c6",
      },
      surface: "#282a36",
    },
  },
  everforest: {
    dark: {
      accent: "#a7c080",
      contrast: 0,
      fonts: {
        code: null,
        ui: null,
      },
      ink: "#d3c6aa",
      semanticColors: {
        diffAdded: "#a7c080",
        diffRemoved: "#e67e80",
        skill: "#d699b6",
      },
      surface: "#2d353b",
    },
    light: {
      accent: "#93b259",
      contrast: 0,
      fonts: {
        code: null,
        ui: null,
      },
      ink: "#5c6a72",
      semanticColors: {
        diffAdded: "#8da101",
        diffRemoved: "#f85552",
        skill: "#df69ba",
      },
      surface: "#fdf6e3",
    },
  },
  github: {
    dark: {
      accent: "#1f6feb",
      contrast: 0,
      fonts: {
        code: null,
        ui: null,
      },
      ink: "#e6edf3",
      semanticColors: {
        diffAdded: "#3fb950",
        diffRemoved: "#f85149",
        skill: "#bc8cff",
      },
      surface: "#0d1117",
    },
    light: {
      accent: "#0969da",
      contrast: 0,
      fonts: {
        code: null,
        ui: null,
      },
      ink: "#1f2328",
      semanticColors: {
        diffAdded: "#1a7f37",
        diffRemoved: "#cf222e",
        skill: "#8250df",
      },
      surface: "#ffffff",
    },
  },
  gruvbox: {
    dark: {
      accent: "#458588",
      contrast: 0,
      fonts: {
        code: null,
        ui: null,
      },
      ink: "#ebdbb2",
      semanticColors: {
        diffAdded: "#ebdbb2",
        diffRemoved: "#cc241d",
        skill: "#b16286",
      },
      surface: "#282828",
    },
    light: {
      accent: "#458588",
      contrast: 0,
      fonts: {
        code: null,
        ui: null,
      },
      ink: "#3c3836",
      semanticColors: {
        diffAdded: "#3c3836",
        diffRemoved: "#cc241d",
        skill: "#b16286",
      },
      surface: "#fbf1c7",
    },
  },
  linear: {
    dark: {
      accent: "#606acc",
      contrast: 0,
      fonts: {
        code: null,
        ui: "Inter",
      },
      ink: "#e3e4e6",
      semanticColors: {
        diffAdded: "#69c967",
        diffRemoved: "#ff7e78",
        skill: "#c2a1ff",
      },
      surface: "#0f0f11",
    },
    light: {
      accent: "#5e6ad2",
      contrast: 0,
      fonts: {
        code: null,
        ui: "Inter",
      },
      ink: "#1b1b1b",
      semanticColors: {
        diffAdded: "#52a450",
        diffRemoved: "#c94446",
        skill: "#8160d8",
      },
      surface: "#fcfcfd",
    },
  },
  material: {
    dark: {
      accent: "#80cbc4",
      contrast: 0,
      fonts: {
        code: null,
        ui: null,
      },
      ink: "#eeffff",
      semanticColors: {
        diffAdded: "#c3e88d",
        diffRemoved: "#f07178",
        skill: "#c792ea",
      },
      surface: "#212121",
    },
  },
  monokai: {
    dark: {
      accent: "#99947c",
      contrast: 0,
      fonts: {
        code: null,
        ui: null,
      },
      ink: "#f8f8f2",
      semanticColors: {
        diffAdded: "#86b42b",
        diffRemoved: "#c4265e",
        skill: "#8c6bc8",
      },
      surface: "#272822",
    },
  },
  "night-owl": {
    dark: {
      accent: "#44596b",
      contrast: 0,
      fonts: {
        code: null,
        ui: null,
      },
      ink: "#d6deeb",
      semanticColors: {
        diffAdded: "#c5e478",
        diffRemoved: "#ef5350",
        skill: "#c792ea",
      },
      surface: "#011627",
    },
  },
  nord: {
    dark: {
      accent: "#88c0d0",
      contrast: 0,
      fonts: {
        code: null,
        ui: null,
      },
      ink: "#d8dee9",
      semanticColors: {
        diffAdded: "#a3be8c",
        diffRemoved: "#bf616a",
        skill: "#b48ead",
      },
      surface: "#2e3440",
    },
  },
  one: {
    dark: {
      accent: "#4d78cc",
      contrast: 0,
      fonts: {
        code: null,
        ui: null,
      },
      ink: "#abb2bf",
      semanticColors: {
        diffAdded: "#8cc265",
        diffRemoved: "#e05561",
        skill: "#c162de",
      },
      surface: "#282c34",
    },
    light: {
      accent: "#526fff",
      contrast: 0,
      fonts: {
        code: null,
        ui: null,
      },
      ink: "#383a42",
      semanticColors: {
        diffAdded: "#3bba54",
        diffRemoved: "#e45649",
        skill: "#526fff",
      },
      surface: "#fafafa",
    },
  },
  "rose-pine": {
    dark: {
      accent: "#ea9a97",
      contrast: 0,
      fonts: {
        code: null,
        ui: null,
      },
      ink: "#e0def4",
      semanticColors: {
        diffAdded: "#9ccfd8",
        diffRemoved: "#908caa",
        skill: "#c4a7e7",
      },
      surface: "#232136",
    },
    light: {
      accent: "#d7827e",
      contrast: 0,
      fonts: {
        code: null,
        ui: null,
      },
      ink: "#575279",
      semanticColors: {
        diffAdded: "#56949f",
        diffRemoved: "#797593",
        skill: "#907aa9",
      },
      surface: "#faf4ed",
    },
  },
  "tokyo-night": {
    dark: {
      accent: "#3d59a1",
      contrast: 0,
      fonts: {
        code: null,
        ui: null,
      },
      ink: "#a9b1d6",
      semanticColors: {
        diffAdded: "#449dab",
        diffRemoved: "#914c54",
        skill: "#9d7cd8",
      },
      surface: "#1a1b26",
    },
  },
  vesper: {
    dark: {
      accent: "#ffc799",
      contrast: 0,
      fonts: { code: null, ui: null },
      ink: "#ffffff",
      semanticColors: { diffAdded: "#99ffe4", diffRemoved: "#ff8080", skill: "#ffc799" },
      surface: "#101010",
    },
  },
  vercel: {
    dark: {
      accent: "#006efe",
      contrast: 0,
      fonts: {
        code: '"Geist Mono", ui-monospace, "SFMono-Regular"',
        ui: "Geist, Inter",
      },
      ink: "#ededed",
      semanticColors: {
        diffAdded: "#00ad3a",
        diffRemoved: "#f13342",
        skill: "#9540d5",
      },
      surface: "#000000",
    },
    light: {
      accent: "#006aff",
      contrast: 0,
      fonts: {
        code: '"Geist Mono", ui-monospace, "SFMono-Regular"',
        ui: "Geist, Inter",
      },
      ink: "#171717",
      semanticColors: {
        diffAdded: "#28a948",
        diffRemoved: "#eb001d",
        skill: "#a100f8",
      },
      surface: "#ffffff",
    },
  },
} as const;
