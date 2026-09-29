// FILE: AuthorAvatar.tsx
// Purpose: Small circular author avatar shared by the pull request and commit history rows, detail headers,
//          reviewers row, and comment cards — an image when GitHub gives us one, otherwise an
//          initials fallback so every actor still reads as a person rather than a blank slot.
// Layer: Shared author presentation
// Exports: AuthorAvatar

import { useState } from "react";

import { cn } from "~/lib/utils";

const SIZE_CLASS_NAME = {
  sm: "size-4 text-[8px]",
  md: "size-5 text-ui-2xs",
  lg: "size-7 text-ui-sm",
} as const;

function initialFor(
  actor: { name?: string | null; login?: string | null; avatarUrl?: string | null } | null,
): string {
  const source = actor?.name?.trim() || actor?.login?.trim();
  return source ? source.slice(0, 1).toUpperCase() : "?";
}

export function AuthorAvatar({
  actor,
  size: sizeProp,
  className,
}: {
  actor: { name?: string | null; login?: string | null; avatarUrl?: string | null } | null;
  size?: keyof typeof SIZE_CLASS_NAME;
  className?: string;
}) {
  const size = sizeProp ?? "sm";
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const sizeClassName = SIZE_CLASS_NAME[size];
  // Render only an avatar URL supplied by the source; a Git name alone does not
  // identify an account and could display another person's photo.
  const src = actor?.avatarUrl;
  if (src && src !== failedSrc) {
    return (
      <img
        src={src}
        alt=""
        loading="lazy"
        decoding="async"
        draggable={false}
        onError={() => setFailedSrc(src)}
        className={cn(
          sizeClassName,
          "shrink-0 rounded-full object-cover ring-1 ring-border/50",
          className,
        )}
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      className={cn(
        sizeClassName,
        "flex shrink-0 items-center justify-center rounded-full bg-[var(--color-background-elevated-secondary)] font-medium text-muted-foreground ring-1 ring-border/50",
        className,
      )}
    >
      {initialFor(actor)}
    </span>
  );
}
