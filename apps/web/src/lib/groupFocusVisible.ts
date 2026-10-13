import type { FocusEvent } from "react";

// Marks a hover-reveal group with `data-focus-visible` while one of its own descendants
// matches :focus-visible, for `group-data-[focus-visible]/<name>:` classes. A group variant
// built on :has(:focus-visible) instead makes Chrome restyle the whole document whenever a
// row mounts. React focus events bubble out of portals, so focus inside a portaled menu is
// ignored here, as it would be by :has().
function syncGroupFocusVisible(event: FocusEvent<HTMLElement>) {
  const group = event.currentTarget;
  const focused = event.target;
  group.toggleAttribute(
    "data-focus-visible",
    group.contains(focused) && focused.matches(":focus-visible"),
  );
}

function clearGroupFocusVisible(event: FocusEvent<HTMLElement>) {
  event.currentTarget.removeAttribute("data-focus-visible");
}

export const GROUP_FOCUS_VISIBLE_PROPS = {
  onBlur: clearGroupFocusVisible,
  onFocus: syncGroupFocusVisible,
};
