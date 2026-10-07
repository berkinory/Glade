import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  type VisualReply,
  VISUAL_REPLY_MAX_DOCUMENT_BYTES,
  VISUAL_REPLY_ROUTE,
} from "@glade/contracts/orchestration/visualReply";
import {
  VISUAL_REPLY_COLUMN_WIDTH,
  visualReplyFrameHeight,
} from "@glade/shared/attachments/visualReplyLayout";
import { Button } from "~/components/ui/button";
import { Dialog, DialogPopup, DialogTitle } from "~/components/ui/dialog";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { ExpandIcon, CollapseIcon, DownloadIcon } from "~/lib/icons";
import { downloadBlob } from "~/lib/browserDownload";
import { resolveWsHttpUrl } from "~/lib/wsHttpUrl";
import { VisualReplyFrame } from "./VisualReplyFrame";

export function VisualReplyCard({
  reply,
  activityId,
}: {
  readonly reply: VisualReply;
  readonly activityId: string;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [contentHeight, setContentHeight] = useState<number>();
  const [width, setWidth] = useState(VISUAL_REPLY_COLUMN_WIDTH);
  const height = visualReplyFrameHeight(reply, width, contentHeight);
  useLayoutEffect(() => {
    const element = container.current;
    if (!element) return;
    const measure = () => setWidth(element.getBoundingClientRect().width);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      // Leaving the viewport must not discard edits held inside the sandbox.
      setVisible(true);
      observer.disconnect();
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const source = useQuery({
    queryKey: ["visual-reply", reply.threadId, activityId, reply.attachmentId],
    enabled: visible || expanded,
    staleTime: Infinity,
    gcTime: 60_000,
    retry: false,
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams({ threadId: reply.threadId, activityId });
      const response = await fetch(resolveWsHttpUrl(`${VISUAL_REPLY_ROUTE}?${params}`), {
        signal,
        credentials: "include",
      });
      if (!response.ok) throw new Error(`Could not load visual (HTTP ${response.status}).`);
      const html = await response.text();
      if (new TextEncoder().encode(html).byteLength > VISUAL_REPLY_MAX_DOCUMENT_BYTES)
        throw new Error("Visual exceeds the document limit.");
      return html;
    },
  });
  const header = (inDialog: boolean) => {
    const actions = [
      {
        id: "save",
        label: "Save HTML",
        icon: DownloadIcon,
        onClick: () => {
          if (source.data)
            downloadBlob(
              new Blob([source.data], { type: "text/html" }),
              `${reply.title.replace(/[^\p{L}\p{N}._-]+/gu, "-") || "visual"}.html`,
            );
        },
      },
      {
        id: "expand",
        label: inDialog ? "Collapse visual" : "Expand visual",
        icon: inDialog ? CollapseIcon : ExpandIcon,
        onClick: () => setExpanded(!inDialog),
      },
    ];
    return (
      <div
        className={
          inDialog
            ? "flex items-center gap-1 border-b border-border px-3 py-2"
            : "absolute end-2 top-2 z-10 flex items-center gap-1 rounded-lg border border-border bg-background/90 p-1 opacity-0 shadow-sm transition-opacity group-hover/visual:opacity-100 focus-within:opacity-100 pointer-coarse:opacity-100"
        }
      >
        {inDialog && (
          <span className="min-w-0 flex-1 truncate text-ui-sm font-medium">{reply.title}</span>
        )}
        {actions.map(({ id, label, icon: Icon, onClick }) => (
          <Tooltip key={id}>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={label}
                  disabled={!source.data}
                  onClick={onClick}
                >
                  <Icon className="size-4" />
                </Button>
              }
            />
            <TooltipPopup>{label}</TooltipPopup>
          </Tooltip>
        ))}
      </div>
    );
  };
  const body = () => {
    if (source.isError)
      return (
        <div className="p-4 text-ui-sm text-destructive">
          <p>{source.error.message}</p>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              void source.refetch();
            }}
          >
            Retry
          </Button>
        </div>
      );
    if (!source.data)
      return <p className="p-4 text-ui-sm text-muted-foreground">Loading visual...</p>;
    return (
      <VisualReplyFrame
        html={source.data}
        title={reply.title}
        onContentHeight={expanded ? undefined : setContentHeight}
      />
    );
  };
  return (
    <>
      <div ref={container} className="group/visual relative my-3" data-visual-reply={activityId}>
        {header(false)}
        <div className="overflow-hidden" style={{ height }}>
          {visible && !expanded ? body() : <div className="h-full bg-muted/20" />}
        </div>
      </div>
      <Dialog
        open={expanded}
        onOpenChange={(open) => {
          setExpanded(open);
        }}
      >
        <DialogPopup showCloseButton={false} className="max-w-6xl overflow-hidden p-0">
          <DialogTitle className="sr-only">{reply.title}</DialogTitle>
          {header(true)}
          <div className="overflow-hidden" style={{ height: "70vh" }}>
            {expanded && body()}
          </div>
        </DialogPopup>
      </Dialog>
    </>
  );
}
