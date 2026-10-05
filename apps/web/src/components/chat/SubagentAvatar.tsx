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
  // Random thread identities distribute avatars without changing them on remount or restart.
  const identity = threadId.startsWith("subagent:")
    ? threadId.slice(threadId.lastIndexOf(":") + 1)
    : threadId;
  let hash = 2166136261;
  for (let i = 0; i < identity.length; i++) {
    hash = Math.imul(hash ^ identity.charCodeAt(i), 16777619);
  }
  return (
    <img
      src={AVATARS[(hash >>> 0) % AVATARS.length]}
      alt=""
      aria-hidden="true"
      draggable={false}
      className={cn("block size-[1.429em] shrink-0 object-contain text-ui", className)}
    />
  );
}
