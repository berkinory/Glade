import circleAttentiveRed from "~/assets/subagents/bloub-circle-attentive-red.svg";
import circleExcitedOrange from "~/assets/subagents/bloub-circle-excited-orange.svg";
import circleShyBrown from "~/assets/subagents/bloub-circle-shy-brown.svg";
import triangleAttentiveTeal from "~/assets/subagents/bloub-triangle-attentive-teal.svg";
import triangleExcitedPurple from "~/assets/subagents/bloub-triangle-excited-purple.svg";
import triangleShyRed from "~/assets/subagents/bloub-triangle-shy-red.svg";
import cloudAttentiveBrown from "~/assets/subagents/bloub-cloud-attentive-brown.svg";
import cloudExcitedTeal from "~/assets/subagents/bloub-cloud-excited-teal.svg";
import cloudShyPurple from "~/assets/subagents/bloub-cloud-shy-purple.svg";
import { cn } from "~/lib/utils";
import { useMemo } from "react";
import { useStore } from "~/store";
import type { AppState } from "~/storeState";
import { subagentAvatarIndex } from "./SubagentAvatar.logic";

const AVATARS = [
  circleAttentiveRed,
  circleExcitedOrange,
  circleShyBrown,
  triangleAttentiveTeal,
  triangleExcitedPurple,
  triangleShyRed,
  cloudAttentiveBrown,
  cloudExcitedTeal,
  cloudShyPurple,
];

export function SubagentAvatar({ threadId, className }: { threadId: string; className?: string }) {
  const selectAvatar = useMemo(() => {
    let previousShells: AppState["threadShellById"];
    let previousIndex = 0;
    let initialized = false;
    return (state: Pick<AppState, "threadShellById">) => {
      if (!initialized || previousShells !== state.threadShellById) {
        previousShells = state.threadShellById;
        previousIndex = subagentAvatarIndex(
          threadId,
          Object.values(previousShells ?? {}),
          AVATARS.length,
        );
        initialized = true;
      }
      return previousIndex;
    };
  }, [threadId]);
  const avatarIndex = useStore(selectAvatar);
  return (
    <img
      src={AVATARS[avatarIndex]}
      alt=""
      aria-hidden="true"
      draggable={false}
      className={cn("block size-[1.429em] shrink-0 object-contain text-ui", className)}
    />
  );
}
