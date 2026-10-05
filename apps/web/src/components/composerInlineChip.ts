import { cn } from "~/lib/utils";
import {
  COMPOSER_EDITOR_LINE_HEIGHT_CLASS_NAME,
  COMPOSER_EDITOR_TEXT_CLASS_NAME,
} from "./chat/composerPickerStyles";

const COMPOSER_INLINE_CHIP_SIDE_GAP_CLASS_NAME = "mx-0.5";
export const COMPOSER_INLINE_CHIP_ICON_LABEL_GAP_CLASS_NAME = "mr-1";

const COMPOSER_INLINE_CHIP_BASE_CLASS_NAME = cn(
  "inline max-w-full select-none align-baseline font-medium",
  COMPOSER_INLINE_CHIP_SIDE_GAP_CLASS_NAME,
  COMPOSER_EDITOR_TEXT_CLASS_NAME,
  COMPOSER_EDITOR_LINE_HEIGHT_CLASS_NAME,
);

export const COMPOSER_INLINE_DECORATOR_HOST_CLASS_NAME = "inline";

type ComposerInlineChipFill = "plain" | "soft";

type ComposerInlineChipTone = "accent" | "neutral";

const COMPOSER_INLINE_CHIP_FILL_CLASS_NAME: Record<ComposerInlineChipFill, string> = {
  plain: "",
  soft: "rounded-md px-2 py-0.5 -translate-y-px",
};

const COMPOSER_INLINE_CHIP_TONE_TEXT_CLASS_NAME: Record<ComposerInlineChipTone, string> = {
  accent: "text-[var(--info-foreground)]",
  neutral: "text-[var(--color-text-foreground)]",
};

const COMPOSER_INLINE_CHIP_TONE_SOFT_BG_CLASS_NAME: Record<ComposerInlineChipTone, string> = {
  accent: "bg-[var(--info)]/10",
  neutral: "bg-[var(--sidebar-accent-active)]",
};

function composerInlineChipClassName(options?: {
  fill?: ComposerInlineChipFill;
  tone?: ComposerInlineChipTone;
  className?: string;
}): string {
  const fill = options?.fill ?? "plain";
  const tone = options?.tone ?? "accent";
  return cn(
    COMPOSER_INLINE_CHIP_BASE_CLASS_NAME,
    COMPOSER_INLINE_CHIP_TONE_TEXT_CLASS_NAME[tone],
    COMPOSER_INLINE_CHIP_FILL_CLASS_NAME[fill],
    fill === "soft" ? COMPOSER_INLINE_CHIP_TONE_SOFT_BG_CLASS_NAME[tone] : null,
    options?.className,
  );
}

export const COMPOSER_EDITOR_INLINE_CHIP_CLASS_NAME = composerInlineChipClassName({
  fill: "plain",
  tone: "accent",
});

export const COMPOSER_INLINE_LINK_CHIP_CLASS_NAME = composerInlineChipClassName({
  fill: "plain",
  tone: "accent",
  // `text-left` resets the UA `<button>` default of `text-align: center`, which otherwise centers a
  // wrapped URL label in the timeline's interactive chip.
  className: "cursor-pointer text-left hover:underline",
});

export const COMPOSER_INLINE_CHIP_TOKEN_ICON_CLASS_NAME =
  "inline-block size-[1em] shrink-0 align-middle -translate-y-px";

export const COMPOSER_INLINE_CHIP_INLINE_ICON_CLASS_NAME = cn(
  COMPOSER_INLINE_CHIP_TOKEN_ICON_CLASS_NAME,
  COMPOSER_INLINE_CHIP_ICON_LABEL_GAP_CLASS_NAME,
);
export const COMPOSER_INLINE_CHIP_LABEL_CLASS_NAME = "inline select-none";

export const COMPOSER_INLINE_AGENT_CHIP_CLASS_NAME = cn(
  "inline-flex max-w-full select-none items-center gap-0.5 font-medium rounded-md px-1.5 py-0.5 align-baseline",
  COMPOSER_INLINE_CHIP_SIDE_GAP_CLASS_NAME,
  COMPOSER_EDITOR_TEXT_CLASS_NAME,
  COMPOSER_EDITOR_LINE_HEIGHT_CLASS_NAME,
);
export const COMPOSER_INLINE_AGENT_CHIP_ICON_CLASS_NAME = "size-3 shrink-0";

export interface AgentChipColor {
  readonly bg: string;
  readonly text: string;
}
const DEFAULT_AGENT_CHIP_COLOR: AgentChipColor = {
  bg: "rgb(245 158 11 / 0.15)",
  text: "rgb(245 158 11)",
};
const AGENT_CHIP_COLOR_BY_NAME: Record<string, AgentChipColor> = {
  violet: { bg: "rgb(139 92 246 / 0.15)", text: "rgb(139 92 246)" },
  fuchsia: { bg: "rgb(217 70 239 / 0.15)", text: "rgb(217 70 239)" },
  teal: { bg: "rgb(20 184 166 / 0.15)", text: "rgb(20 184 166)" },
  cyan: { bg: "rgb(6 182 212 / 0.15)", text: "rgb(6 182 212)" },
  amber: DEFAULT_AGENT_CHIP_COLOR,
  orange: { bg: "rgb(249 115 22 / 0.15)", text: "rgb(249 115 22)" },
};
export function resolveAgentChipColor(color: string | undefined): AgentChipColor {
  return (color ? AGENT_CHIP_COLOR_BY_NAME[color] : undefined) ?? DEFAULT_AGENT_CHIP_COLOR;
}

export const COMPOSER_INLINE_MENTION_CHIP_INTERACTIVE_CLASS_NAME = composerInlineChipClassName({
  fill: "plain",
  tone: "accent",
  className: "cursor-pointer text-left hover:underline",
});

export const COMPOSER_INLINE_CHIP_CLASS_NAME =
  "inline-flex max-w-full select-none items-center gap-0.5 rounded border border-[color:var(--color-border-light)] bg-[var(--sidebar-accent-active)] p-0.5 font-medium text-ui-sm leading-[1.1] text-[var(--color-text-foreground)] align-middle";

export const COMPOSER_INLINE_CHIP_ICON_CLASS_NAME = "size-3.5 shrink-0 opacity-85";

export const COMPOSER_ATTACHMENT_CHIP_CLASS_NAME =
  "inline-flex min-w-0 max-w-full items-center gap-0.5 rounded-full border border-[color:var(--color-border)] bg-[var(--composer-surface)] p-px text-ui-sm font-medium text-[var(--color-text-foreground)]";

function formatComposerInlineTokenLabel(name: string): string {
  return name
    .split(/[-_]/)
    .map((segment) =>
      segment.length > 0 ? segment.charAt(0).toUpperCase() + segment.slice(1) : segment,
    )
    .join(" ");
}

export function formatComposerSkillChipLabel(name: string): string {
  return formatComposerInlineTokenLabel(name);
}

export function formatComposerSlashCommandChipLabel(command: string): string {
  return formatComposerInlineTokenLabel(command);
}
