import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  type VisualReply,
  VISUAL_REPLY_MAX_DOCUMENT_BYTES,
  VISUAL_REPLY_ROUTE,
} from "@glade/contracts/orchestration/visualReply";
import { Button } from "~/components/ui/button";
import { Dialog, DialogPopup, DialogTitle } from "~/components/ui/dialog";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { ExpandIcon, CollapseIcon, CodeSquareIcon, DownloadIcon, ViewIcon } from "~/lib/icons";
import { FileContentsView } from "~/components/WorkspaceFileContents";
import { useTheme } from "~/hooks/useTheme";
import { resolveDiffThemeName } from "~/lib/diffRendering";
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
  const { resolvedTheme } = useTheme();
  const [visible, setVisible] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [sourceOpen, setSourceOpen] = useState(false);
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const observer = new IntersectionObserver((entries) => {
      const inView = entries.some((entry) => entry.isIntersecting);
      setVisible(inView);
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
        id: "source",
        label: sourceOpen ? "View visual" : "View source",
        icon: sourceOpen ? ViewIcon : CodeSquareIcon,
        pressed: sourceOpen,
        onClick: () => {
          setSourceOpen((value) => !value);
        },
      },
      {
        id: "save",
        label: "Save HTML",
        icon: DownloadIcon,
        pressed: undefined,
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
        pressed: undefined,
        onClick: () => setExpanded(!inDialog),
      },
    ];
    return (
      <div className="flex items-center gap-1 border-b border-border px-3 py-2">
        <span className="min-w-0 flex-1 truncate text-ui-sm font-medium">{reply.title}</span>
        {actions.map(({ id, label, icon: Icon, pressed, onClick }) => (
          <Tooltip key={id}>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={label}
                  aria-pressed={pressed}
                  disabled={!source.data}
                  onClick={onClick}
                  className={pressed ? "bg-accent text-accent-foreground" : undefined}
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
    if (sourceOpen)
      return (
        <div className="editor-file-viewer h-full overflow-auto text-ui-sm">
          <FileContentsView
            path="visual.html"
            contents={source.data}
            themeName={resolveDiffThemeName(resolvedTheme)}
          />
        </div>
      );
    return <VisualReplyFrame html={source.data} title={reply.title} />;
  };
  return (
    <>
      <div
        ref={container}
        className="my-3 overflow-hidden rounded-xl border border-border bg-card"
        data-visual-reply={activityId}
      >
        {header(false)}
        <div className="overflow-hidden" style={{ height: "min(420px, 60vh)" }}>
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
