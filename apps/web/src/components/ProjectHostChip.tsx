import { useRemoteEnvironments } from "~/environments/remoteEnvironments";
import { remoteHostAvailability } from "~/environments/remoteEnvironmentStatus";
import { CloudServerIcon, ServerIcon } from "~/lib/icons";
import { cn } from "~/lib/utils";
import { sidebarHoverRevealHideClassName, type SidebarHoverRevealGroup } from "../sidebarRowStyles";
import type { Project } from "../types";
import { SidebarMetaChipStack } from "./SidebarMetaChip";
import { SidebarGlyph } from "./sidebarGlyphs";

export function ProjectHostChip(props: {
  readonly project: Project;
  readonly group?: SidebarHoverRevealGroup;
}) {
  const environment = useRemoteEnvironments().find(
    (candidate) => candidate.key === props.project.environmentKey,
  );
  if (!environment) return null;
  const availability = remoteHostAvailability(environment);
  return (
    <div
      className={cn(
        "ml-auto flex shrink-0 items-center",
        sidebarHoverRevealHideClassName(props.group ?? "project-header"),
      )}
    >
      <SidebarMetaChipStack
        chips={[
          {
            id: "ssh-host",
            tooltip: `On ${environment.host.label}${environment.kind === "ssh" ? " over SSH" : ""}\n${availability.reason}`,
            icon: (
              <SidebarGlyph
                icon={environment.kind === "ssh" ? ServerIcon : CloudServerIcon}
                variant="meta"
                className="text-muted-foreground/55"
              />
            ),
          },
        ]}
      />
    </div>
  );
}
