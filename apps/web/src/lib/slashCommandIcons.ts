import type { IconComponent } from "~/lib/iconComponent";
import {
  Brain03Icon,
  CursorInWindowIcon,
  BugIcon,
  EraserIcon,
  EnergyFilledIcon,
  WorkflowCircle04Icon,
  ListTodoIcon,
  MessageCircleIcon,
  FilterIcon,
} from "~/lib/icons";
const SLASH_COMMAND_ICONS: Record<string, IconComponent> = {
  clear: EraserIcon,
  compact: FilterIcon,
  model: Brain03Icon,
  fast: EnergyFilledIcon,
  plan: ListTodoIcon,
  debug: BugIcon,
  default: MessageCircleIcon,
  review: BugIcon,
  fork: WorkflowCircle04Icon,
  "computer-use": CursorInWindowIcon,
  feedback: BugIcon,
};
export function slashCommandIcon(command: string, fallback: IconComponent): IconComponent {
  return SLASH_COMMAND_ICONS[command] ?? fallback;
}
