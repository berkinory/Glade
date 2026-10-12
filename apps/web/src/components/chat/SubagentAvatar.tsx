import { cn } from "~/lib/utils";
import { useMemo, type ReactNode } from "react";
import { useStore } from "~/store";
import type { AppState } from "~/storeState";
import { subagentAvatarIndex } from "./SubagentAvatar.logic";

interface AvatarStyle {
  tone: string;
  glyph: ReactNode;
}

const AVATARS: ReadonlyArray<AvatarStyle> = [
  {
    tone: "bg-rose-500/15 text-rose-600 dark:text-rose-300",
    glyph: (
      <>
        <circle cx="8" cy="4.9" r="2.9" />
        <circle cx="11.1" cy="8" r="2.9" />
        <circle cx="8" cy="11.1" r="2.9" />
        <circle cx="4.9" cy="8" r="2.9" />
      </>
    ),
  },
  {
    tone: "bg-amber-500/15 text-amber-600 dark:text-amber-300",
    glyph: <path d="M8 1.5 9.7 6.3 14.5 8 9.7 9.7 8 14.5 6.3 9.7 1.5 8 6.3 6.3Z" />,
  },
  {
    tone: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300",
    glyph: (
      <>
        <path
          d="M8 2.2 13 5.1v5.8L8 13.8 3 10.9V5.1Z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
        <circle cx="8" cy="8" r="2" />
      </>
    ),
  },
  {
    tone: "bg-violet-500/15 text-violet-600 dark:text-violet-300",
    glyph: (
      <>
        <rect x="2.5" y="2.5" width="5" height="5" rx="1.5" />
        <rect x="8.5" y="2.5" width="5" height="5" rx="1.5" opacity="0.45" />
        <rect x="2.5" y="8.5" width="5" height="5" rx="1.5" opacity="0.45" />
        <rect x="8.5" y="8.5" width="5" height="5" rx="1.5" />
      </>
    ),
  },
  {
    tone: "bg-teal-500/15 text-teal-600 dark:text-teal-300",
    glyph: (
      <>
        <circle cx="8" cy="4.4" r="2.6" />
        <circle cx="4.4" cy="10.6" r="2.6" />
        <circle cx="11.6" cy="10.6" r="2.6" />
      </>
    ),
  },
  {
    tone: "bg-sky-500/15 text-sky-600 dark:text-sky-300",
    glyph: (
      <>
        <ellipse cx="8" cy="4.3" rx="1.8" ry="3.1" transform="rotate(0 8 8)" />
        <ellipse cx="8" cy="4.3" rx="1.8" ry="3.1" transform="rotate(60 8 8)" />
        <ellipse cx="8" cy="4.3" rx="1.8" ry="3.1" transform="rotate(120 8 8)" />
        <ellipse cx="8" cy="4.3" rx="1.8" ry="3.1" transform="rotate(180 8 8)" />
        <ellipse cx="8" cy="4.3" rx="1.8" ry="3.1" transform="rotate(240 8 8)" />
        <ellipse cx="8" cy="4.3" rx="1.8" ry="3.1" transform="rotate(300 8 8)" />
      </>
    ),
  },
  {
    tone: "bg-fuchsia-500/15 text-fuchsia-600 dark:text-fuchsia-300",
    glyph: (
      <>
        <ellipse cx="8" cy="4.6" rx="2" ry="3.4" transform="rotate(45 8 8)" />
        <ellipse cx="8" cy="4.6" rx="2" ry="3.4" transform="rotate(135 8 8)" />
        <ellipse cx="8" cy="4.6" rx="2" ry="3.4" transform="rotate(225 8 8)" />
        <ellipse cx="8" cy="4.6" rx="2" ry="3.4" transform="rotate(315 8 8)" />
      </>
    ),
  },
  {
    tone: "bg-lime-500/15 text-lime-700 dark:text-lime-300",
    glyph: (
      <>
        <ellipse cx="8" cy="4.7" rx="2.4" ry="3.6" transform="rotate(0 8 8)" />
        <ellipse cx="8" cy="4.7" rx="2.4" ry="3.6" transform="rotate(120 8 8)" />
        <ellipse cx="8" cy="4.7" rx="2.4" ry="3.6" transform="rotate(240 8 8)" />
      </>
    ),
  },
  {
    tone: "bg-orange-500/15 text-orange-600 dark:text-orange-300",
    glyph: (
      <>
        <circle cx="8" cy="8" r="2.8" />
        <circle cx="13.5" cy="8" r="1.1" />
        <circle cx="11.9" cy="11.9" r="1.1" />
        <circle cx="8" cy="13.5" r="1.1" />
        <circle cx="4.1" cy="11.9" r="1.1" />
        <circle cx="2.5" cy="8" r="1.1" />
        <circle cx="4.1" cy="4.1" r="1.1" />
        <circle cx="8" cy="2.5" r="1.1" />
        <circle cx="11.9" cy="4.1" r="1.1" />
      </>
    ),
  },
  {
    tone: "bg-indigo-500/15 text-indigo-600 dark:text-indigo-300",
    glyph: (
      <>
        <circle cx="5" cy="5" r="2.9" />
        <circle cx="11" cy="5" r="2.9" />
        <circle cx="5" cy="11" r="2.9" opacity="0.5" />
        <circle cx="11" cy="11" r="2.9" opacity="0.5" />
      </>
    ),
  },
  {
    tone: "bg-cyan-500/15 text-cyan-600 dark:text-cyan-300",
    glyph: (
      <>
        <path d="M8 8V2a3 3 0 0 1 0 6Z" />
        <path d="M8 8V2a3 3 0 0 1 0 6Z" transform="rotate(90 8 8)" />
        <path d="M8 8V2a3 3 0 0 1 0 6Z" transform="rotate(180 8 8)" />
        <path d="M8 8V2a3 3 0 0 1 0 6Z" transform="rotate(270 8 8)" />
      </>
    ),
  },
  {
    tone: "bg-pink-500/15 text-pink-600 dark:text-pink-300",
    glyph: (
      <>
        <circle cx="8" cy="4.7" r="2.6" />
        <circle cx="11.14" cy="6.98" r="2.6" />
        <circle cx="9.94" cy="10.67" r="2.6" />
        <circle cx="6.06" cy="10.67" r="2.6" />
        <circle cx="4.86" cy="6.98" r="2.6" />
      </>
    ),
  },
];

export function SubagentAvatar({ threadId, className }: { threadId: string; className?: string }) {
  // The store selector must be stable per thread: it reruns the sibling ordering only when the
  // thread shells change, not on every store update.
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
  const avatar = AVATARS[useStore(selectAvatar)] ?? AVATARS[0]!;
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex size-[1.429em] shrink-0 items-center justify-center rounded-[30%] text-ui",
        avatar.tone,
        className,
      )}
    >
      <svg viewBox="0 0 16 16" fill="currentColor" className="size-[68%]">
        {avatar.glyph}
      </svg>
    </span>
  );
}
