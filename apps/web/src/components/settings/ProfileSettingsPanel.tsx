import { Share02Icon, PencilEdit02Icon } from "~/lib/icons";
import { type ReactNode, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { type ProfileStats, type ProfileTokenStats } from "@glade/contracts/server/stats";
import {
  serverProfileStatsQueryOptions,
  serverProfileTokenStatsQueryOptions,
} from "~/lib/serverReactQuery";
import { Button } from "~/components/ui/button";
import { Skeleton } from "~/components/ui/skeleton";
import { cn } from "~/lib/utils";
import { ActivityHeatmap, APP_HEATMAP_INTENSITY_CLASSES } from "../profile/ActivityHeatmap";
import { ModelUsageList } from "../profile/ModelUsageList";
import {
  selectProfileDayProviders,
  selectProfileHeatmap,
  selectProfileRangeSummary,
} from "../profile/profileSelectors";
import { ProfileUsageCoverage } from "../profile/ProfileUsageCoverage";
import { ShareDialog } from "../profile/ShareDialog";
import { EditProfileDialog } from "../profile/EditProfileDialog";
import { TokenTooltipContent } from "../profile/TokenTooltipContent";
import { TokenUsageChart } from "../profile/TokenUsageChart";
import { useProfileHandle } from "../profile/useProfileHandle";
import { useProfileName } from "../profile/useProfileName";
import { useProfileAvatarColor } from "../profile/useProfileAvatarColor";
import { useProfileAvatarImage } from "../profile/useProfileAvatarImage";
import { useProfileRange } from "../profile/useProfileRange";
import { ProfileAvatar } from "../profile/ProfileAvatar";
import {
  formatAgentDuration,
  formatCompact,
  formatNumber,
  formatPeriodLabel,
  toDisplayName,
} from "../profile/profileFormatting";
import { SettingsSegmentedControl } from "./SettingControls";
import { SettingsCard, SettingsEmptyState, SettingsSectionShell } from "./SettingsPanelPrimitives";

const RANGE_OPTIONS = [
  { value: "month", label: "Monthly" },
  { value: "all", label: "All time" },
] as const;

export function ProfileSettingsPanel() {
  const coreQuery = useQuery(serverProfileStatsQueryOptions());
  const tokenQuery = useQuery(serverProfileTokenStatsQueryOptions());
  if (coreQuery.isPending) {
    return <ProfileSkeleton />;
  }
  if (coreQuery.isError || !coreQuery.data) {
    return (
      <div className="flex flex-col items-center gap-3 py-24 text-center">
        <p className="text-ui leading-snug text-muted-foreground">
          Couldn’t load your local stats.
        </p>
        <Button variant="outline" size="sm" onClick={() => void coreQuery.refetch()}>
          Try again
        </Button>
      </div>
    );
  }
  return (
    <ProfileContent
      stats={coreQuery.data}
      tokenStats={tokenQuery.data ?? null}
      tokensPending={tokenQuery.isPending}
    />
  );
}

function ProfileContent({
  stats,
  tokenStats,
  tokensPending,
}: {
  stats: ProfileStats;
  tokenStats: ProfileTokenStats | null;
  tokensPending: boolean;
}) {
  const [shareOpen, setShareOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const defaultName = toDisplayName(stats.identity.homeDirBasename);
  const { name, setName } = useProfileName(defaultName);
  const { handle, setHandle } = useProfileHandle(stats.identity.defaultHandle);
  const { color: avatarColor, setColor: setAvatarColor } = useProfileAvatarColor();
  const { image: avatarImage, setImage: setAvatarImage } = useProfileAvatarImage();

  const [range, setRange] = useProfileRange();

  const heatmap = selectProfileHeatmap(stats, tokenStats);
  const summary = selectProfileRangeSummary(stats, tokenStats, range);
  const tokens = tokenStats?.available ? tokenStats : null;

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <header className="flex items-center gap-3">
        <ProfileAvatar seed={handle} color={avatarColor} image={avatarImage} className="size-12" />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h2 className="truncate text-ui-lg font-medium text-foreground">{name}</h2>
          <span className="truncate text-ui-sm text-muted-foreground">{handle}</span>
        </div>
        <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
          <PencilEdit02Icon />
          Edit
        </Button>
        <Button variant="outline" size="sm" onClick={() => setShareOpen(true)}>
          <Share02Icon />
          Share
        </Button>
      </header>

      <SettingsSegmentedControl
        value={range}
        onValueChange={setRange}
        options={RANGE_OPTIONS}
        ariaLabel="Stats range"
      />

      <SettingsCard divided={false} className="grid grid-cols-2 sm:grid-cols-4">
        <StatTile label="Tokens" value={tokensPending ? null : formatCompact(summary.tokens)} />
        <StatTile label="Agent time" value={formatAgentDuration(summary.agentSeconds)} />
        <StatTile label="Chats" value={formatNumber(summary.chats)} />
        <StatTile
          label="Peak day"
          value={tokensPending ? null : formatCompact(summary.peakDayTokens)}
        />
      </SettingsCard>

      <ProfileSection title="Activity">
        <ActivityHeatmap
          cells={heatmap.cells}
          layout={{ fill: true, radius: 3, gap: 3 }}
          months={{ show: true, position: "bottom" }}
          renderTooltip={(cell) => (
            <TokenTooltipContent
              title={formatPeriodLabel(cell.day, cell.day, "day")}
              total={cell.count}
              unit={heatmap.unit}
              providers={
                heatmap.unit === "tokens" ? selectProfileDayProviders(tokens, cell.day) : []
              }
            />
          )}
        />
        <div className="flex items-center justify-end gap-1.5 text-ui-xs text-muted-foreground">
          Less
          {APP_HEATMAP_INTENSITY_CLASSES.map((className) => (
            <span key={className} className={cn("size-2.5 rounded-[3px]", className)} />
          ))}
          More
        </div>
      </ProfileSection>

      <ProfileSection title="Token usage">
        {tokensPending ? (
          <Skeleton className="h-48 w-full rounded-lg" />
        ) : tokens ? (
          <>
            <TokenUsageChart
              buckets={summary.buckets}
              granularity={summary.granularity}
              providers={summary.providers}
            />
            <ProfileUsageCoverage unavailableProviders={tokens.unavailableProviders} />
          </>
        ) : (
          <SettingsEmptyState>No token usage tracked yet.</SettingsEmptyState>
        )}
      </ProfileSection>

      {summary.models.length > 0 ? (
        <ProfileSection title="Models">
          <ModelUsageList models={summary.models} />
        </ProfileSection>
      ) : null}

      <ShareDialog
        stats={stats}
        tokenStats={tokenStats}
        displayName={name}
        handle={handle}
        avatarColor={avatarColor}
        avatarImage={avatarImage}
        open={shareOpen}
        onOpenChange={setShareOpen}
      />

      <EditProfileDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        seed={handle}
        name={name}
        handle={handle}
        avatarColor={avatarColor}
        avatarImage={avatarImage}
        onSave={({
          name: nextName,
          handle: nextHandle,
          avatarColor: nextColor,
          avatarImage: nextImage,
        }) => {
          setName(nextName);
          setHandle(nextHandle);
          setAvatarColor(nextColor);
          setAvatarImage(nextImage);
        }}
      />
    </div>
  );
}

function ProfileSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <SettingsSectionShell title={title}>
      <SettingsCard divided={false} className="flex flex-col gap-3 p-4">
        {children}
      </SettingsCard>
    </SettingsSectionShell>
  );
}

function StatTile({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex flex-col gap-1 border-border px-4 py-3 not-first:border-l max-sm:nth-3:border-l-0 max-sm:nth-[n+3]:border-t">
      <span className="text-ui-sm text-muted-foreground">{label}</span>
      {value === null ? (
        <Skeleton className="h-5 w-14" />
      ) : (
        <span className="text-ui-lg font-medium text-foreground tabular-nums">{value}</span>
      )}
    </div>
  );
}

function ProfileSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-3">
        <Skeleton className="size-12 rounded-full" />
        <div className="flex flex-col gap-1.5">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-3 w-20" />
        </div>
      </div>
      <Skeleton className="h-20 w-full rounded-xl" />
      <Skeleton className="h-40 w-full rounded-xl" />
      <Skeleton className="h-32 w-full rounded-xl" />
    </div>
  );
}
