import type { SVGProps } from "react";
import { PinFilledIcon, PinIcon } from "./icons";

export function pinActionLabel(target: string, pinned: boolean): string {
  return `${pinned ? "Unpin" : "Pin"} ${target}`;
}

// State-reflecting pin glyph: the solid fill-set pin once pinned, the outline pin otherwise.
// Outline reads as a quiet "pin me" affordance (e.g. revealed on row hover); the fill confirms the
// pinned state. Single source so no surface drifts.
export function PinStatusIcon({ pinned, ...props }: SVGProps<SVGSVGElement> & { pinned: boolean }) {
  const Icon = pinned ? PinFilledIcon : PinIcon;
  return <Icon {...props} />;
}
