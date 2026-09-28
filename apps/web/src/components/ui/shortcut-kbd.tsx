import { Kbd, SHORTCUT_KBD_CLASS_NAME } from "./kbd";
import { cn } from "~/lib/utils";

export function ShortcutKbd(props: { shortcutLabel: string; className?: string }) {
  return <Kbd className={cn(SHORTCUT_KBD_CLASS_NAME, props.className)}>{props.shortcutLabel}</Kbd>;
}
