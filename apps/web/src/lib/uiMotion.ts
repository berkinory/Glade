// Shared timings for interaction motion. Nothing here delays the action itself.
export const UI_MOTION_QUICK_MS = 120;
export const UI_MOTION_REVEAL_MS = 160;
export const UI_MOTION_PANEL_MS = 180;

export const UI_MOTION_QUICK_CLASS = "duration-120 ease-out motion-reduce:transition-none";
export const UI_MOTION_REVEAL_CLASS = "duration-160 ease-out motion-reduce:transition-none";
export const UI_MOTION_PANEL_CLASS = "duration-180 ease-out motion-reduce:transition-none";

export const UI_MOTION_POPUP_CLASS =
  "transition-[opacity,scale] duration-120 ease-out data-starting-style:scale-[0.985] data-starting-style:opacity-0 data-ending-style:scale-[0.985] data-ending-style:opacity-0 data-instant:transition-none motion-reduce:transition-none";

export const UI_MOTION_RESIZING_POPUP_CLASS =
  "transition-[width,height,opacity,scale] duration-120 ease-out data-starting-style:scale-[0.985] data-starting-style:opacity-0 data-ending-style:scale-[0.985] data-ending-style:opacity-0 data-instant:transition-none motion-reduce:transition-none";

export const UI_MOTION_BACKDROP_CLASS =
  "transition-opacity duration-160 ease-out data-starting-style:opacity-0 data-ending-style:opacity-0 motion-reduce:transition-none";

export const UI_MOTION_DIALOG_CLASS =
  "transition-[scale,opacity,translate] duration-160 ease-out data-starting-style:scale-[0.985] data-starting-style:opacity-0 data-ending-style:scale-[0.985] data-ending-style:opacity-0 motion-reduce:transition-none";
