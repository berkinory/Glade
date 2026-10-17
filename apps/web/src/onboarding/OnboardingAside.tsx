import { APP_BASE_NAME } from "~/branding";
import { GladeLogo } from "~/components/GladeLogo";
import { useTheme } from "~/hooks/useTheme";
import { CheckIcon } from "~/lib/icons";
import { cn } from "~/lib/utils";
import { ONBOARDING_STEPS, type OnboardingStep } from "./logic";

const STEP_LABELS: Record<OnboardingStep, string> = {
  welcome: "Welcome",
  agents: "Agents",
  permissions: "Permissions",
  start: "First project",
};

// The artwork panel doubles as the progress rail: each step names the choice made there, so the
// summary of the whole setup is always visible and any visited step is one click away.
export function OnboardingAside(props: {
  step: OnboardingStep;
  visited: ReadonlySet<OnboardingStep>;
  summaries: Record<OnboardingStep, string>;
  navigationLocked: boolean;
  onSelect: (step: OnboardingStep) => void;
}) {
  const { resolvedTheme } = useTheme();
  const currentIndex = ONBOARDING_STEPS.indexOf(props.step);
  return (
    <aside className="relative flex min-h-0 flex-col justify-between overflow-hidden border-e border-foreground/6 bg-card">
      <img
        src={`/artwork/landing-${resolvedTheme}.webp`}
        alt=""
        aria-hidden
        draggable={false}
        className="pointer-events-none absolute inset-0 size-full object-cover object-[50%_30%] opacity-80 select-none dark:opacity-55"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "linear-gradient(to bottom, color-mix(in srgb, var(--card) 35%, transparent) 0%, transparent 22%, transparent 38%, color-mix(in srgb, var(--card) 70%, transparent) 58%, var(--card) 78%)",
        }}
      />
      <div className="relative flex items-center gap-2 px-7 pt-7">
        <GladeLogo aria-hidden className="size-5" />
        <span className="text-ui-lg font-semibold tracking-[-0.01em]">{APP_BASE_NAME}</span>
      </div>
      <ol className="relative flex flex-col gap-1 px-4 pb-6" aria-label="Setup steps">
        {ONBOARDING_STEPS.map((step, index) => {
          const current = step === props.step;
          const done = index < currentIndex;
          const reachable = props.visited.has(step) && !current && !props.navigationLocked;
          return (
            <li key={step}>
              <button
                type="button"
                disabled={!reachable}
                aria-current={current ? "step" : undefined}
                onClick={() => props.onSelect(step)}
                className={cn(
                  "flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-start outline-none transition-colors focus-visible:ring-1 focus-visible:ring-ring motion-reduce:transition-none",
                  current && "bg-foreground/6",
                  reachable && "cursor-pointer hover:bg-foreground/4",
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    "mt-px flex size-5 shrink-0 items-center justify-center rounded-full border text-ui-2xs tabular-nums",
                    current
                      ? "border-foreground bg-foreground text-background"
                      : done
                        ? "border-foreground/30 text-foreground"
                        : "border-foreground/15 text-muted-foreground",
                  )}
                >
                  {done ? <CheckIcon className="size-3" /> : index + 1}
                </span>
                <span className="flex min-w-0 flex-col">
                  <span
                    className={cn(
                      "text-ui font-medium",
                      current || done ? "text-foreground" : "text-muted-foreground",
                    )}
                  >
                    {STEP_LABELS[step]}
                  </span>
                  <span className="truncate text-ui-sm text-muted-foreground">
                    {props.summaries[step]}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </aside>
  );
}
