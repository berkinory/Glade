import { useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";

import { CheckIcon, Copy01Icon, XIcon } from "~/lib/icons";
import { useCopyToClipboard } from "~/lib/clipboard";
import { cn } from "~/lib/utils";
import { Alert, AlertDescription, AlertTitle } from "../ui/alert";
import { Button } from "../ui/button";
import { DisclosureChevron } from "../ui/DisclosureChevron";
import { IconButton } from "../ui/icon-button";

interface ChatErrorNoticeProps {
  title: string;
  error: string;
  actions?: ReactNode;
  onDismiss?: () => void;
  className?: string;
}

export function ChatErrorNotice(props: ChatErrorNoticeProps) {
  // A different failure starts collapsed, with fresh copy feedback.
  return <ChatErrorNoticeContent key={props.error} {...props} />;
}

function ChatErrorNoticeContent({
  title,
  error,
  actions,
  onDismiss,
  className,
}: ChatErrorNoticeProps) {
  const [expanded, setExpanded] = useState(false);
  const [clamped, setClamped] = useState(false);
  const textRef = useRef<HTMLParagraphElement>(null);
  const detailsId = useId();
  const [copyFailed, setCopyFailed] = useState(false);
  const { copyToClipboard, isCopied } = useCopyToClipboard<void>({
    onCopy: () => setCopyFailed(false),
    onError: () => setCopyFailed(true),
  });
  // Offer "Show details" only when the collapsed text actually hides something.
  useLayoutEffect(() => {
    const node = textRef.current;
    if (!node || expanded) return;
    const measure = () => setClamped(node.scrollHeight > node.clientHeight + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [expanded]);
  return (
    <Alert variant="error" className={cn("relative", className)}>
      <AlertTitle className={cn("text-destructive", onDismiss && "pr-7")}>{title}</AlertTitle>
      <AlertDescription className="min-w-0 gap-1.5">
        <p
          ref={textRef}
          id={detailsId}
          className={cn(
            "whitespace-pre-wrap [overflow-wrap:anywhere]",
            expanded ? "max-h-60 overflow-y-auto" : "line-clamp-3",
          )}
          tabIndex={expanded ? 0 : undefined}
        >
          {error}
        </p>
        <div className="flex flex-wrap items-center gap-1">
          {clamped || expanded ? (
            <Button
              size="xs"
              variant="ghost"
              aria-expanded={expanded}
              aria-controls={detailsId}
              onClick={() => setExpanded((value) => !value)}
            >
              <DisclosureChevron open={expanded} />
              {expanded ? "Hide details" : "Show details"}
            </Button>
          ) : null}
          <Button size="xs" variant="ghost" onClick={() => copyToClipboard(error)}>
            {isCopied ? <CheckIcon className="text-success" /> : <Copy01Icon />}
            {isCopied ? "Copied" : copyFailed ? "Copy failed" : "Copy error"}
          </Button>
          {actions}
        </div>
      </AlertDescription>
      {onDismiss ? (
        <IconButton
          label="Dismiss error"
          variant="ghost"
          size="icon-xs"
          className="absolute top-2 right-2 text-destructive/60 hover:text-destructive"
          onClick={onDismiss}
        >
          <XIcon />
        </IconButton>
      ) : null}
    </Alert>
  );
}
