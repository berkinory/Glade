import { Button } from "~/components/ui/button";

const FOOTER_BUTTON_CLASS_NAME = "px-4 text-ui-lg sm:text-ui-lg";

export function OnboardingStepFooter(props: {
  showBack: boolean;
  onBack: () => void;
  onSkip: () => void;
  primaryLabel: string;
  onPrimary: () => void;
  busy: boolean;
}) {
  return (
    <div className="flex items-center gap-2 border-t border-foreground/6 px-10 py-4">
      <Button
        variant="ghost"
        size="sm"
        shape="capsule"
        className="-ms-2.5 text-muted-foreground"
        disabled={props.busy}
        onClick={props.onSkip}
      >
        Skip setup
      </Button>
      <div className="flex-1" />
      {props.showBack ? (
        <Button
          variant="ghost"
          shape="capsule"
          className={FOOTER_BUTTON_CLASS_NAME}
          disabled={props.busy}
          onClick={props.onBack}
        >
          Back
        </Button>
      ) : null}
      <Button
        variant="prominent"
        shape="capsule"
        className={`${FOOTER_BUTTON_CLASS_NAME} hover:scale-100`}
        disabled={props.busy}
        onClick={props.onPrimary}
      >
        {props.busy ? "Working…" : props.primaryLabel}
      </Button>
    </div>
  );
}
