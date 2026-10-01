export const PROJECT_COLORS = [
  "red",
  "orange",
  "yellow",
  "green",
  "blue",
  "purple",
  "pink",
] as const;
export type ProjectColor = (typeof PROJECT_COLORS)[number];

export const PROJECT_COLOR_LABELS: Record<ProjectColor, string> = {
  red: "Red",
  orange: "Orange",
  yellow: "Yellow",
  green: "Green",
  blue: "Blue",
  purple: "Purple",
  pink: "Pink",
};

export function projectColorValue(color: ProjectColor): string {
  return `var(--project-${color})`;
}

export interface ProjectIconOption {
  readonly name: string;
  readonly label: string;

  readonly keywords: string;
}

export const DEFAULT_PROJECT_ICON = "folder-2";

export const PROJECT_ICON_OPTIONS: ReadonlyArray<ProjectIconOption> = [
  { name: DEFAULT_PROJECT_ICON, label: "Folder", keywords: "default directory project" },
  { name: "dollar", label: "Money", keywords: "finance dollar budget cash" },
  { name: "book", label: "Book", keywords: "reading docs library" },
  { name: "graduate-cap", label: "Education", keywords: "school study course learn" },
  { name: "pencil", label: "Writing", keywords: "edit draft blog" },
  { name: "feather", label: "Pen", keywords: "writing poetry quill" },
  { name: "brackets-2", label: "Code", keywords: "braces json dev programming" },
  { name: "console", label: "Terminal", keywords: "shell cli command" },
  { name: "audio", label: "Music", keywords: "song sound note" },
  { name: "popcorn", label: "Movies", keywords: "film cinema entertainment" },
  { name: "ruler", label: "Design", keywords: "layout measure architecture" },
  { name: "color-palette", label: "Art", keywords: "paint colors creative" },
  { name: "heart-beat", label: "Health", keywords: "medical doctor pulse" },
  { name: "medicine-pill", label: "Medicine", keywords: "pharmacy pills care" },
  { name: "form-flower", label: "Wellness", keywords: "calm lotus mindfulness" },
  { name: "suitcase-work", label: "Work", keywords: "briefcase job business office" },
  { name: "chart-3", label: "Analytics", keywords: "chart stats data metrics" },
  { name: "dumbell", label: "Fitness", keywords: "gym workout sport" },
  { name: "notebook", label: "Notes", keywords: "journal notebook diary" },
  { name: "law", label: "Law", keywords: "legal scale justice balance" },
  { name: "globe", label: "Globe", keywords: "web internet world" },
  { name: "airplane", label: "Travel", keywords: "plane trip flight" },
  { name: "earth", label: "Earth", keywords: "planet world climate" },
  { name: "maintenance", label: "Tools", keywords: "wrench fix settings repair" },
  { name: "pets", label: "Pets", keywords: "paw dog cat animal" },
  { name: "lab", label: "Science", keywords: "flask lab research experiment" },
  { name: "brain", label: "Brain", keywords: "mind ai thinking research" },
  { name: "heart", label: "Heart", keywords: "love favorite personal" },
  { name: "tree", label: "Nature", keywords: "plant garden tree green" },
  { name: "rocket", label: "Launch", keywords: "rocket startup ship" },
  { name: "light-bulb", label: "Idea", keywords: "lightbulb ideas brainstorm" },
  { name: "star", label: "Star", keywords: "favorite important" },
  { name: "camera-1", label: "Photo", keywords: "camera pictures photography" },
  { name: "gamecontroller", label: "Games", keywords: "gaming play controller" },
  { name: "home", label: "Home", keywords: "house personal family" },
  { name: "people", label: "People", keywords: "team user community" },
  { name: "robot", label: "Bot", keywords: "robot ai agent automation" },
  { name: "cup-hot", label: "Coffee", keywords: "tea break drink" },
  { name: "shopping-bag-1", label: "Shopping", keywords: "store shop ecommerce" },
  { name: "bug", label: "Bugs", keywords: "debug issue qa" },
  { name: "server", label: "Server", keywords: "backend infra database hosting" },
  { name: "puzzle", label: "Puzzle", keywords: "plugin extension piece" },
  { name: "trophy", label: "Trophy", keywords: "win award goal" },
  { name: "target", label: "Goal", keywords: "target focus objective" },
  { name: "map-pin", label: "Place", keywords: "location map local" },
  { name: "chat-bubbles", label: "Chat", keywords: "messages conversation support" },
  { name: "calendar-1", label: "Calendar", keywords: "schedule date plan events" },
  { name: "lightning", label: "Speed", keywords: "fast bolt power energy" },
];

const PROJECT_ICON_NAMES = new Set(PROJECT_ICON_OPTIONS.map((option) => option.name));

export type ProjectAppearance =
  | { readonly kind: "icon"; readonly icon: string; readonly color: ProjectColor | null }
  | { readonly kind: "emoji"; readonly emoji: string };

const EMOJI_PATTERN = /\p{Extended_Pictographic}|\p{Regional_Indicator}|\u{20E3}/u;
const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

export function firstEmoji(value: string): string | null {
  for (const { segment } of graphemeSegmenter.segment(value)) {
    if (EMOJI_PATTERN.test(segment)) return segment;
  }
  return null;
}

export function normalizeProjectAppearance(
  appearance: ProjectAppearance | null,
): ProjectAppearance | null {
  if (!appearance) return null;
  if (appearance.kind === "icon") {
    return appearance.icon === DEFAULT_PROJECT_ICON && appearance.color === null
      ? null
      : appearance;
  }
  return appearance;
}

export function projectAppearanceEquals(
  left: ProjectAppearance | null,
  right: ProjectAppearance | null,
): boolean {
  return projectAppearanceKey(left) === projectAppearanceKey(right);
}

function projectAppearanceKey(appearance: ProjectAppearance | null): string {
  if (!appearance) return "default";
  return appearance.kind === "icon"
    ? `icon:${appearance.icon}:${appearance.color ?? ""}`
    : `emoji:${appearance.emoji}`;
}

export function parseProjectAppearance(value: unknown): ProjectAppearance | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  if (record.kind === "icon" && typeof record.icon === "string") {
    if (!PROJECT_ICON_NAMES.has(record.icon)) return null;
    const color = PROJECT_COLORS.find((candidate) => candidate === record.color) ?? null;
    return normalizeProjectAppearance({ kind: "icon", icon: record.icon, color });
  }
  if (record.kind === "emoji" && typeof record.emoji === "string") {
    const emoji = firstEmoji(record.emoji);
    return emoji === record.emoji ? { kind: "emoji", emoji } : null;
  }
  return null;
}
