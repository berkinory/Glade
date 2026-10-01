import { FeatureSection } from "./FeatureSection";
import type { WhatsNewFeature } from "./logic";

const CATEGORY_TONES: Record<string, { text: string; dot: string }> = {
  New: {
    text: "text-emerald-600 dark:text-emerald-300/90",
    dot: "bg-emerald-500 dark:bg-emerald-300/90",
  },
  Improved: {
    text: "text-sky-600 dark:text-sky-300/90",
    dot: "bg-sky-500 dark:bg-sky-300/90",
  },
  Fixed: {
    text: "text-amber-600 dark:text-amber-300/90",
    dot: "bg-amber-500 dark:bg-amber-300/90",
  },
  Removed: {
    text: "text-rose-600 dark:text-rose-300/90",
    dot: "bg-rose-500 dark:bg-rose-300/90",
  },
};

export function ReleaseNotesSections(props: { features: readonly WhatsNewFeature[] }) {
  const groups = new Map<string, WhatsNewFeature[]>();
  for (const feature of props.features) {
    const group = groups.get(feature.category) ?? [];
    group.push(feature);
    groups.set(feature.category, group);
  }

  return (
    <div className="flex flex-col gap-6">
      {[...groups].map(([category, features]) => (
        <section key={category} aria-label={category}>
          <div className="mb-1 flex items-center gap-2 border-b border-border/60 pb-2">
            <span
              aria-hidden="true"
              className={`size-1.5 shrink-0 rounded-full ${CATEGORY_TONES[category]?.dot ?? "bg-muted-foreground"}`}
            />
            <h3
              className={`text-ui-sm font-semibold ${CATEGORY_TONES[category]?.text ?? "text-foreground"}`}
            >
              {category}
            </h3>
          </div>
          <ul className="divide-y divide-border/40">
            {features.map((feature) => (
              <FeatureSection key={feature.description} feature={feature} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
