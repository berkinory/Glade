import type { IconComponent } from "~/lib/iconComponent";
import {
  Robot01Icon,
  Brain03Icon,
  BugIcon,
  MousePointer01Icon,
  EraserIcon,
  EnergyFilledIcon,
  WorkflowCircle04Icon,
  InfoIcon,
  ListTodoIcon,
  MessageCircleIcon,
  CollapseIcon,
} from "~/lib/icons";
const SLASH_COMMAND_ICONS: Record<string, IconComponent> = {
  clear: EraserIcon,
  compact: CollapseIcon,
  model: Brain03Icon,
  fast: EnergyFilledIcon,
  plan: ListTodoIcon,
  debug: BugIcon,
  default: MessageCircleIcon,
  review: BugIcon,
  fork: WorkflowCircle04Icon,
  status: InfoIcon,
  subagents: Robot01Icon,
  feedback: BugIcon,
  "computer-use": MousePointer01Icon,
};
export function slashCommandIcon(command: string, fallback: IconComponent): IconComponent {
  return SLASH_COMMAND_ICONS[command] ?? fallback;
}
