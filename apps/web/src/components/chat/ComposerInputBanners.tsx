import { type ReactNode } from "react";

import { cn } from "~/lib/utils";
import { ComposerAutomationSetupBanner } from "./ComposerAutomationSetupBanner";
import { ComposerPlanFollowUpBanner } from "./ComposerPlanFollowUpBanner";
import { COMPOSER_INPUT_SURFACE_BANNER_CLASS_NAME } from "./composerPickerStyles";

interface ComposerInputBannersProps {
  roundedTopReset: boolean;

  planFollowUp: { id: string; title: string | null } | null;

  automationSetup: { onCancel: () => void } | null;
}

export function ComposerInputBanners({
  roundedTopReset,
  planFollowUp,
  automationSetup,
}: ComposerInputBannersProps) {
  let content: ReactNode = null;
  if (planFollowUp) {
    content = <ComposerPlanFollowUpBanner key={planFollowUp.id} planTitle={planFollowUp.title} />;
  } else if (automationSetup) {
    content = <ComposerAutomationSetupBanner onCancel={automationSetup.onCancel} />;
  }

  if (!content) {
    return null;
  }

  return (
    <div
      className={cn(
        COMPOSER_INPUT_SURFACE_BANNER_CLASS_NAME,
        "divide-y divide-[color:var(--color-border-light)]",
        roundedTopReset && "!rounded-t-none",
      )}
    >
      {content}
    </div>
  );
}
