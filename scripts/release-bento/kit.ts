import { readFileSync } from "node:fs";
import { join } from "node:path";
import AlertCircleGlyph from "@hugeicons/core-free-icons/AlertCircleIcon";
import ArrowDown02Glyph from "@hugeicons/core-free-icons/ArrowDown02Icon";
import ArrowRight02Glyph from "@hugeicons/core-free-icons/ArrowRight02Icon";
import ArrowUp02Glyph from "@hugeicons/core-free-icons/ArrowUp02Icon";
import ArrowUpRightGlyph from "@hugeicons/core-free-icons/ArrowUpRight01Icon";
import BotGlyph from "@hugeicons/core-free-icons/BotIcon";
import Brain03Glyph from "@hugeicons/core-free-icons/Brain03Icon";
import Bug01Glyph from "@hugeicons/core-free-icons/Bug01Icon";
import ChevronDownGlyph from "@hugeicons/core-free-icons/ChevronDownIcon";
import ChevronRightGlyph from "@hugeicons/core-free-icons/ChevronRightIcon";
import CircleCheckGlyph from "@hugeicons/core-free-icons/CircleCheckIcon";
import CloudDownloadGlyph from "@hugeicons/core-free-icons/CloudDownloadIcon";
import CloudUploadGlyph from "@hugeicons/core-free-icons/CloudUploadIcon";
import Comment01Glyph from "@hugeicons/core-free-icons/Comment01Icon";
import ComputerTerminal01Glyph from "@hugeicons/core-free-icons/ComputerTerminal01Icon";
import Copy01Glyph from "@hugeicons/core-free-icons/Copy01Icon";
import File02Glyph from "@hugeicons/core-free-icons/File02Icon";
import Folder01Glyph from "@hugeicons/core-free-icons/Folder01Icon";
import GitCommitHorizontalGlyph from "@hugeicons/core-free-icons/GitCommitHorizontalIcon";
import GitPullRequestGlyph from "@hugeicons/core-free-icons/GitPullRequestIcon";
import LayoutAlignLeftGlyph from "@hugeicons/core-free-icons/LayoutAlignLeftIcon";
import MagicWand01Glyph from "@hugeicons/core-free-icons/MagicWand01Icon";
import PencilEdit02Glyph from "@hugeicons/core-free-icons/PencilEdit02Icon";
import PlusMinusSquare01Glyph from "@hugeicons/core-free-icons/PlusMinusSquare01Icon";
import RefreshCwGlyph from "@hugeicons/core-free-icons/RefreshCwIcon";
import Search01Glyph from "@hugeicons/core-free-icons/Search01Icon";
import ServerStack01Glyph from "@hugeicons/core-free-icons/ServerStack01Icon";
import SparklesGlyph from "@hugeicons/core-free-icons/SparklesIcon";
import SquarePenGlyph from "@hugeicons/core-free-icons/SquarePenIcon";
import ToolsGlyph from "@hugeicons/core-free-icons/ToolsIcon";
import TriangleAlertGlyph from "@hugeicons/core-free-icons/TriangleAlertIcon";
import UndoGlyph from "@hugeicons/core-free-icons/UndoIcon";
import XGlyph from "@hugeicons/core-free-icons/XIcon";
import { GLADE_MARK_PATH, GLADE_MARK_VIEWBOX } from "../../apps/web/src/assets/gladeMark.ts";

export interface ReleaseCounts {
  readonly New: number;
  readonly Improved: number;
  readonly Fixed: number;
}

export interface ReleaseBento {
  /** Column and tile sizes for this release's grid; the shared styles live in bento.css. */
  readonly css: string;
  readonly render: (release: {
    readonly version: string;
    readonly counts: ReleaseCounts;
  }) => string;
}

const WEB_PUBLIC = join(import.meta.dirname, "../../apps/web/public");

// The same Hugeicons glyphs the app maps in apps/web/src/lib/icons.tsx.
const GLYPHS = {
  AlertCircle: AlertCircleGlyph,
  ArrowDown02: ArrowDown02Glyph,
  ArrowRight02: ArrowRight02Glyph,
  ArrowUp02: ArrowUp02Glyph,
  ArrowUpRight: ArrowUpRightGlyph,
  Bot: BotGlyph,
  Brain: Brain03Glyph,
  Bug: Bug01Glyph,
  ChevronDown: ChevronDownGlyph,
  ChevronRight: ChevronRightGlyph,
  CircleCheck: CircleCheckGlyph,
  CloudDownload: CloudDownloadGlyph,
  CloudUpload: CloudUploadGlyph,
  Comment: Comment01Glyph,
  ComputerTerminal: ComputerTerminal01Glyph,
  Copy: Copy01Glyph,
  File02: File02Glyph,
  Folder: Folder01Glyph,
  GitCommitHorizontal: GitCommitHorizontalGlyph,
  GitPullRequest: GitPullRequestGlyph,
  LayoutAlignLeft: LayoutAlignLeftGlyph,
  MagicWand: MagicWand01Glyph,
  PencilEdit02: PencilEdit02Glyph,
  PlusMinusSquare: PlusMinusSquare01Glyph,
  RefreshCw: RefreshCwGlyph,
  Search: Search01Glyph,
  ServerStack: ServerStack01Glyph,
  Sparkles: SparklesGlyph,
  SquarePen: SquarePenGlyph,
  Tools: ToolsGlyph,
  TriangleAlert: TriangleAlertGlyph,
  Undo: UndoGlyph,
  X: XGlyph,
} as const;

export type IconName = keyof typeof GLYPHS;

const kebab = (key: string) => key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);

export function icon(name: IconName, size = 16, className = ""): string {
  const children = GLYPHS[name]
    .map(([tag, attributes]) => {
      const attrs = Object.entries(attributes)
        .filter(([key]) => key !== "key")
        .map(([key, value]) => `${kebab(key)}="${String(value)}"`)
        .join(" ");
      return `<${tag} ${attrs}/>`;
    })
    .join("");
  return `<svg class="ic ${className}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none">${children}</svg>`;
}

function mark(size: number): string {
  return `<svg width="${size}" height="${size}" viewBox="${GLADE_MARK_VIEWBOX}"><path d="${GLADE_MARK_PATH}" fill="currentColor"/></svg>`;
}

function dataUri(path: string): string {
  return `data:image/svg+xml;base64,${readFileSync(path).toString("base64")}`;
}

/** A file-type icon from the app's symbol theme, e.g. `ts` or `markdown`. */
export function fileIcon(symbol: string, size = 14): string {
  return `<img src="${dataUri(join(WEB_PUBLIC, "symbols/files", `${symbol}.svg`))}" width="${size}" height="${size}" alt="">`;
}

const LOGOS = {
  github: join(WEB_PUBLIC, "brands/github_light.svg"),
  claude: join(WEB_PUBLIC, "brands/claude-ai-icon.svg"),
  openai: join(import.meta.dirname, "../../apps/web/src/assets/brands/openai.svg"),
} as const;

/** A brand logo as the app shows it; GitHub and OpenAI take the text color. */
export function logo(name: keyof typeof LOGOS, size = 15): string {
  const svg = readFileSync(LOGOS[name], "utf8")
    .replace(/fill="#1b1f23"/g, 'fill="currentColor"')
    .replace(/<svg([^>]*?) fill="none"/, '<svg$1 fill="currentColor"')
    .replace(/ width="\d+" height="\d+"/, "");
  return svg.replace("<svg", `<svg class="ic" width="${size}" height="${size}"`);
}

/** The macOS app icon, rendered by scripts/generate-brand-assets.ts. */
export function appIcon(appearance: "light" | "dark", size: number): string {
  const file = appearance === "dark" ? "icon-dark.png" : "icon.png";
  const png = readFileSync(join(import.meta.dirname, "../../apps/desktop/resources", file));
  return `<img src="data:image/png;base64,${png.toString("base64")}" width="${size}" height="${size}" alt="">`;
}

// Still frames of the app's loaders (apps/web/src/components/ui/spinner.tsx).
const ARC = 2 * Math.PI * 9;
const LOADERS = {
  action: `<g fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><circle r="9" stroke-opacity="0.14"/><circle r="9" stroke-dasharray="${ARC / 4} ${ARC}"/></g>`,
  loading: [
    [-9, -9, 1],
    [1, -9, 0.7],
    [-9, 1, 0.7],
    [1, 1, 0.45],
  ]
    .map(
      ([x, y, opacity]) =>
        `<rect x="${x}" y="${y}" width="8" height="8" rx="1.4" fill="currentColor" opacity="${opacity}"/>`,
    )
    .join(""),
  working:
    '<rect x="-7" y="-7" width="14" height="14" rx="1.5" fill="none" stroke="currentColor" stroke-width="2.5"/>',
  subagent: [
    [0, 1],
    [120, 0.68],
    [240, 0.42],
  ]
    .map(
      ([angle, opacity]) =>
        `<circle cy="-7" r="3.4" fill="currentColor" opacity="${opacity}" transform="rotate(${angle})"/>`,
    )
    .join(""),
  voice:
    '<rect x="-10.5" y="-2.75" width="5.5" height="5.5" rx="2.75" fill="currentColor" opacity="0.38"/><rect x="-2.75" y="-7.5" width="5.5" height="15" rx="2.75" fill="currentColor"/><rect x="5" y="-2.75" width="5.5" height="5.5" rx="2.75" fill="currentColor" opacity="0.38"/>',
} as const;

export function loader(variant: keyof typeof LOADERS, size = 16): string {
  return `<svg class="ic" width="${size}" height="${size}" viewBox="-12 -12 24 24">${LOADERS[variant]}</svg>`;
}

// Glyphs and tones from apps/web/src/components/chat/SubagentAvatar.tsx.
const AVATARS = {
  rose: '<circle cx="8" cy="4.9" r="2.9"/><circle cx="11.1" cy="8" r="2.9"/><circle cx="8" cy="11.1" r="2.9"/><circle cx="4.9" cy="8" r="2.9"/>',
  amber: '<path d="M8 1.5 9.7 6.3 14.5 8 9.7 9.7 8 14.5 6.3 9.7 1.5 8 6.3 6.3Z"/>',
  emerald:
    '<path d="M8 2.2 13 5.1v5.8L8 13.8 3 10.9V5.1Z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><circle cx="8" cy="8" r="2"/>',
  violet:
    '<rect x="2.5" y="2.5" width="5" height="5" rx="1.5"/><rect x="8.5" y="2.5" width="5" height="5" rx="1.5" opacity="0.45"/><rect x="2.5" y="8.5" width="5" height="5" rx="1.5" opacity="0.45"/><rect x="8.5" y="8.5" width="5" height="5" rx="1.5"/>',
  sky: [0, 60, 120, 180, 240, 300]
    .map((angle) => `<ellipse cx="8" cy="4.3" rx="1.8" ry="3.1" transform="rotate(${angle} 8 8)"/>`)
    .join(""),
} as const;

export function avatar(tone: keyof typeof AVATARS, size = 22): string {
  return `<span class="avatar tone-${tone}" style="width:${size}px;height:${size}px"><svg width="${size * 0.68}" height="${size * 0.68}" viewBox="0 0 16 16" fill="currentColor">${AVATARS[tone]}</svg></span>`;
}

export function copy(title: string, body: string): string {
  return `<header><h2>${title}</h2><p>${body}</p></header>`;
}

export function toggle(on: boolean): string {
  return `<span class="switch${on ? " on" : ""}"><i></i></span>`;
}

export function brand(version: string): string {
  return `<section class="tile brand"><div class="lockup">${mark(44)}<span>Glade</span></div><div class="ver">${version}</div></section>`;
}

// Same category tones as the app's release notes (apps/web/src/whatsNew/ReleaseNotesSections.tsx).
export function stats(counts: ReleaseCounts): string {
  const stat = (category: string, glyph: IconName, value: number, label: string) =>
    `<div class="stat stat-${category}"><span class="stat-ic">${icon(glyph, 22)}</span><div class="num">${value}</div><div class="lbl">${label}</div></div>`;
  return `<section class="tile stats">${[
    stat("fixed", "Bug", counts.Fixed, counts.Fixed === 1 ? "fix" : "fixes"),
    stat(
      "improved",
      "Sparkles",
      counts.Improved,
      counts.Improved === 1 ? "improvement" : "improvements",
    ),
    stat("new", "MagicWand", counts.New, counts.New === 1 ? "new feature" : "new features"),
  ].join("")}</section>`;
}
