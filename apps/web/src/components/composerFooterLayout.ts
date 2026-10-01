const COMPOSER_FOOTER_COMPACT_BREAKPOINT_PX = 620;
const COMPOSER_FOOTER_WIDE_ACTIONS_COMPACT_BREAKPOINT_PX = 720;

export function shouldUseCompactComposerFooter(
  width: number | null,
  options?: { hasWideActions?: boolean },
): boolean {
  const breakpoint = options?.hasWideActions
    ? COMPOSER_FOOTER_WIDE_ACTIONS_COMPACT_BREAKPOINT_PX
    : COMPOSER_FOOTER_COMPACT_BREAKPOINT_PX;
  return width !== null && width < breakpoint;
}

export interface ComposerFooterControlsPlan {
  showContextMeter: boolean;
  showModelLabel: boolean;
  showTraitsLabel: boolean;
  relocateLeadingControls: boolean;
}

const COMPOSER_FOOTER_MAX_TIER = 4;

const COMPOSER_FOOTER_TIER_PROMOTION_SLACK_PX = 32;

export function composerFooterPlanForTier(
  tier: number,
  hasContextMeter: boolean,
): ComposerFooterControlsPlan {
  return {
    showContextMeter: hasContextMeter && tier < 1,
    showTraitsLabel: tier < 2,
    showModelLabel: tier < 3,
    relocateLeadingControls: tier >= 4,
  };
}

export interface ComposerFooterTierStep {
  tier: number;

  demotionWidths: ReadonlyArray<number | undefined>;
}

export function resolveNextComposerFooterTier(input: {
  currentTier: number;
  clientWidth: number;

  isOverflowing: boolean;
  demotionWidths: ReadonlyArray<number | undefined>;
}): ComposerFooterTierStep {
  const demotionWidths = [...input.demotionWidths];
  let tier = Math.max(0, Math.min(input.currentTier, COMPOSER_FOOTER_MAX_TIER));

  while (tier > 0) {
    const richerTierOverflowedAt = demotionWidths[tier - 1];
    if (
      richerTierOverflowedAt !== undefined &&
      input.clientWidth < richerTierOverflowedAt + COMPOSER_FOOTER_TIER_PROMOTION_SLACK_PX
    ) {
      break;
    }
    tier -= 1;
  }

  if (input.isOverflowing && tier < COMPOSER_FOOTER_MAX_TIER) {
    demotionWidths[tier] = input.clientWidth;
    tier += 1;
  }

  return { tier, demotionWidths };
}
