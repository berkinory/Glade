import { cn } from "~/lib/utils";

import type { WhatsNewFeature } from "./logic";

export interface FeatureSectionProps {
  readonly feature: WhatsNewFeature;
  readonly className?: string;
}

export function FeatureSection({ feature, className }: FeatureSectionProps) {
  return (
    <li className={cn("flex gap-3 py-2.5", className)}>
      <span
        aria-hidden="true"
        className="mt-2 size-1 shrink-0 rounded-full bg-muted-foreground/60"
      />
      <div className="min-w-0 flex-1">
        <p className="text-ui leading-relaxed text-foreground/90">
          {feature.description}
          {feature.commit ? (
            <a
              href={`https://github.com/berkinory/Glade/commit/${feature.commit}`}
              target="_blank"
              rel="noopener noreferrer"
              className="ml-2 whitespace-nowrap text-ui-xs text-muted-foreground underline decoration-muted-foreground/40 underline-offset-2 hover:text-foreground"
              aria-label={`View commit ${feature.commit.slice(0, 7)}`}
            >
              {feature.commit.slice(0, 7)}
            </a>
          ) : null}
        </p>
      </div>
    </li>
  );
}
