import { useRemoteEnvironments } from "~/environments/remoteEnvironments";
import { ServerStack01Icon } from "~/lib/icons";
import { cn } from "~/lib/utils";
import { sidebarHoverRevealHideClassName } from "../sidebarRowStyles";
import type { Project } from "../types";
import { SidebarMetaChipStack } from "./SidebarMetaChip";
import { SidebarGlyph } from "./sidebarGlyphs";

// Marks a project that lives on an SSH host, like a thread's fork or worktree chip. The host's
// connection state shows next to the composer of its chats, not here.
export function ProjectHostChip(props: { readonly project: Project }) {
  const host = useRemoteEnvironments().find(
    (environment) => environment.key === props.project.environmentKey,
  )?.host;
  if (!host) return null;
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
            tooltip: `On ${host.label} over SSH`,
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
