import { NamedIcon } from "~/lib/namedIcons";
import {
  SPACE_ICON_NAMES,
  type SpaceIconName,
} from "@glade/contracts/orchestration/threadEntities";
import { UNFILED_SPACE_SPECIAL_ICON, type VoidSpaceIconName } from "~/lib/spaceGrouping";
import { cn } from "~/lib/utils";
export type SpaceIconValue = VoidSpaceIconName;
const SPACE_ICON_LABELS: Record<SpaceIconName, string> = {
  bag: "Bag",
  home: "Home",
  "code-brackets": "Code",
  rocket: "Rocket",
  "light-bulb": "Idea",
  "color-palette": "Palette",
  book: "Book",
  lab: "Lab",
  heart: "Heart",
  star: "Star",
  globe: "Globe",
  cloud: "Cloud",
  hammer: "Hammer",
  "chart-2": "Chart",
  gamecontroller: "Games",
  "camera-1": "Camera",
  target: "Target",
  tree: "Tree",
  school: "School",
  backpack: "Backpack",
};
export interface SpaceIconOption {
  readonly name: SpaceIconValue;
  readonly label: string;
}
export const SPACE_ICON_OPTIONS: ReadonlyArray<SpaceIconOption> = SPACE_ICON_NAMES.map((name) => ({
  name,
  label: SPACE_ICON_LABELS[name],
}));
export const VOID_SPACE_ICON_OPTIONS: ReadonlyArray<SpaceIconOption> = [
  {
    name: UNFILED_SPACE_SPECIAL_ICON,
    label: "Black hole",
  },
  ...SPACE_ICON_OPTIONS,
];
export function SpaceIcon(props: {
  icon: SpaceIconValue;
  className?: string | undefined;
  label?: string;
}) {
  return (
    <NamedIcon
      name={props.icon}
      aria-label={props.label}
      className={cn("size-4", props.className)}
    />
  );
}
