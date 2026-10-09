import { useRemoteEnvironments } from "~/environments/remoteEnvironments";
import { ServerStack01Icon } from "~/lib/icons";
import { cn } from "~/lib/utils";
import { sidebarHoverRevealHideClassName } from "../sidebarRowStyles";
import type { Project } from "../types";
import { SidebarMetaChipStack } from "./SidebarMetaChip";
import { SidebarGlyph } from "./sidebarGlyphs";

// Marks a project that lives on an SSH host or a paired machine, like a thread's fork or worktree chip. The host's
// connection state shows next to the composer of its chats, not here.
export function ProjectHostChip(props: { readonly project: Project }) {
  const environment = useRemoteEnvironments().find(
    (candidate) => candidate.key === props.project.environmentKey,
  );
  if (!environment) return null;
  return (
    <div
      className={cn(
        "ml-auto flex shrink-0 items-center",
        sidebarHoverRevealHideClassName("project-header"),
      )}
    >
      <SidebarMetaChipStack
        chips={[
          {
            id: "ssh-host",
            tooltip:
              environment.kind === "ssh"
                ? `On ${environment.host.label} over SSH`
                : `On ${environment.host.label}`,
            icon: (
              <SidebarGlyph
                icon={ServerStack01Icon}
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
