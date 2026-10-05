import type { IconComponent } from "~/lib/iconComponent";
import { ClaudeIcon, OpenAIIcon } from "~/lib/brandIcons";
import { type ProviderKind } from "@glade/contracts/core/baseSchemas";
import type { ReactNode, SVGProps } from "react";
import { cn } from "~/lib/utils";
type ProviderIconTone = "default" | "header";
export const PROVIDER_ICON_COMPONENT_BY_PROVIDER: Record<ProviderKind, IconComponent> = {
  codex: OpenAIIcon,
  claudeAgent: ClaudeIcon,
};
function providerIconToneClassName(
  provider: ProviderKind | null | undefined,
  tone: ProviderIconTone = "default",
): string {
  if (provider === "codex") {
    return tone === "header" ? "text-muted-foreground/85" : "text-foreground";
  }
  return "text-foreground";
}
export type ProviderIconProps = Omit<SVGProps<SVGSVGElement>, "ref"> & {
  readonly provider: ProviderKind | null | undefined;
  readonly fallback?: ReactNode;
  readonly tone?: ProviderIconTone;
};
export function ProviderIcon({
  provider,
  fallback: fallbackProp,
  tone: toneProp,
  className,
  "aria-hidden": ariaHiddenProp,
  ...svgProps
}: ProviderIconProps) {
  const fallback = fallbackProp ?? null;
  const tone = toneProp ?? "default";
  const ariaHidden = ariaHiddenProp ?? true;
  if (provider === null || provider === undefined) {
    return fallback;
  }
  const Icon = PROVIDER_ICON_COMPONENT_BY_PROVIDER[provider];
  return (
    <Icon
      aria-hidden={ariaHidden}
      {...svgProps}
      className={cn(providerIconToneClassName(provider, tone), className)}
    />
  );
}
export function ProviderOptionLabel({
  provider,
  label,
  className,
  iconClassName,
}: {
  provider: ProviderKind;
  label: ReactNode;
  className?: string;
  iconClassName?: string;
}) {
  return (
    <span className={cn("flex min-w-0 items-center gap-2", className)}>
      <ProviderIcon provider={provider} className={cn("size-3.5", iconClassName)} />
      <span className="min-w-0 truncate">{label}</span>
    </span>
  );
}
