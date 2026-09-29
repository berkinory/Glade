import type { EditorOptions } from "@pierre/diffs/edit";

export const CODE_EDITOR_KEYMAP = [
  { platform: "mac", bindings: { "cmd+y": "redo" } },
] as const satisfies NonNullable<EditorOptions<undefined>["keymap"]>;
