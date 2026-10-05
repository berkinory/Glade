import { ArrowLeft02Icon, ArrowRight02Icon } from "~/lib/icons";
import { goBackInAppHistory, goForwardInAppHistory, useAppNavigationState } from "~/appNavigation";
import { isElectron } from "~/env";
import { cn, isMacNavigatorPlatform } from "~/lib/utils";
import { Button } from "./ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";
export function AppNavigationButtons({ className }: { className?: string }) {
  const { canGoBack, canGoForward } = useAppNavigationState();
  const isMac = isMacNavigatorPlatform();
  const backShortcutLabel = isMac ? "⌘[" : "Alt+Left";
  const forwardShortcutLabel = isMac ? "⌘]" : "Alt+Right";
  if (!isElectron) {
    return null;
  }
  return (
    <div className={cn("-ms-1 flex shrink-0 items-center gap-0.5", className)}>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="size-8 rounded-lg"
              aria-label="Back"
              disabled={!canGoBack}
              onClick={() => goBackInAppHistory()}
            />
          }
        >
          <ArrowLeft02Icon className="size-6" />
        </TooltipTrigger>
        <TooltipPopup side="bottom">Back ({backShortcutLabel})</TooltipPopup>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="size-8 rounded-lg"
              aria-label="Forward"
              disabled={!canGoForward}
              onClick={() => goForwardInAppHistory()}
            />
          }
        >
          <ArrowRight02Icon className="size-6" />
        </TooltipTrigger>
        <TooltipPopup side="bottom">Forward ({forwardShortcutLabel})</TooltipPopup>
      </Tooltip>
    </div>
  );
}
