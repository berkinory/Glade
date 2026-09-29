import type { EditorOptions } from "@pierre/diffs/edit";

export const CODE_EDITOR_KEYMAP = [
  { platform: "mac", bindings: { "cmd+y": "redo" } },
] as const satisfies NonNullable<EditorOptions<undefined>["keymap"]>;

// A rejected import is cached forever by the dynamic-import registry, so the
// retry path clears the memoized promise to force a fresh load attempt.
