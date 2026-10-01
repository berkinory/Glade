import {
  BotIcon,
  BrainIcon,
  BugIcon,
  ClockIcon,
  ComputerUseIcon,
  EraserIcon,
  FastModeIcon,
  GitBranchIcon,
  InfoIcon,
  ListTodoIcon,
  type LucideIcon,
  MessageCircleIcon,
  Minimize2,
} from "./icons";

const SLASH_COMMAND_ICONS: Record<string, LucideIcon> = {
  clear: EraserIcon,
  compact: Minimize2,
  model: BrainIcon,
  fast: FastModeIcon,
  plan: ListTodoIcon,
  debug: BugIcon,
  default: MessageCircleIcon,
  review: BugIcon,
  fork: GitBranchIcon,
  status: InfoIcon,
  subagents: BotIcon,
  feedback: BugIcon,
  automation: ClockIcon,

  "computer-use": ComputerUseIcon,
};

export function slashCommandIcon(command: string, fallback: LucideIcon): LucideIcon {
  return SLASH_COMMAND_ICONS[command] ?? fallback;
}
