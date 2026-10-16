import type {
  GitReadFileAtRevInput,
  GitReadFileAtRevResult,
  GitReadRequestOptions,
} from "@glade/contracts/git/git";
import { isSupportedLocalImagePath } from "@glade/shared/attachments/localPreviewFiles";
import { isSupportedLocalVideoPath } from "@glade/shared/attachments/localVideoFiles";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ensureNativeApi } from "~/nativeApi";
import { LocalMediaPlayer } from "../LocalMediaPlayer";
import { FileEntryIcon } from "./FileEntryIcon";
import { PanelEmptyState } from "./PanelEmptyState";
import { PanelStateMessage } from "./PanelStateMessage";

function GitMediaUnavailable(props: { path: string; description: string }) {
  return (
    <PanelEmptyState
      icon={<FileEntryIcon pathValue={props.path} kind="file" className="size-12" />}
      title="Preview unavailable"
      description={props.description}
    />
  );
}

export function isGitMediaPath(path: string) {
  return isSupportedLocalImagePath(path) || isSupportedLocalVideoPath(path);
}

function mediaType(path: string): string {
  const extension = path.slice(path.lastIndexOf(".")).toLowerCase();
  const types: Record<string, string> = {
    ".svg": "image/svg+xml",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".avif": "image/avif",
    ".bmp": "image/bmp",
    ".ico": "image/x-icon",
    ".mp4": "video/mp4",
    ".m4v": "video/mp4",
    ".mov": "video/quicktime",
    ".webm": "video/webm",
    ".ogv": "video/ogg",
  };
  return types[extension] ?? "application/octet-stream";
}

export function GitMediaPreview(props: {
  cwd: string;
  path: string;
  revision: "workingTree" | "index" | string;
}) {
  const video = isSupportedLocalVideoPath(props.path);
  const data = useQuery({
    queryKey: ["git", "media", props.cwd, props.path, props.revision],
    queryFn: ({ signal }) => {
      const read: (
        input: GitReadFileAtRevInput,
        options?: GitReadRequestOptions,
      ) => Promise<GitReadFileAtRevResult> = ensureNativeApi().git.readFileAtRev;
      return read(
        {
          cwd: props.cwd,
          filePath: props.path,
          encoding: "base64",
          ...(["index", "workingTree"].includes(props.revision)
            ? { base: props.revision as "index" | "workingTree" }
            : { rev: props.revision }),
        },
        { signal },
      );
    },
    staleTime: ["index", "workingTree"].includes(props.revision) ? 0 : Infinity,
    gcTime: 0,
    retry: false,
  });
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const [resource, setResource] = useState<{ contents: string; url: string } | null>(null);
  useEffect(() => {
    if (!data.data || data.data.missing || data.data.truncated) return;
    const bytes = Uint8Array.from(atob(data.data.contents), (character) => character.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], { type: mediaType(props.path) }));
    setResource({ contents: data.data.contents, url });
    return () => URL.revokeObjectURL(url);
  }, [data.data, props.path]);

  if (data.isError || data.data?.missing || data.data?.truncated)
    return (
      <GitMediaUnavailable
        path={props.path}
        description="This file is missing at this revision or too large to preview."
      />
    );
  const url = resource?.contents === data.data?.contents ? resource?.url : null;
  if (url && failedUrl === url)
    return (
      <GitMediaUnavailable path={props.path} description="Glade can't decode this image format." />
    );
  if (!url) return <PanelStateMessage density="compact" loadingLabel="Loading selected media" />;
  return video ? (
    <LocalMediaPlayer
      kind="video"
      url={url}
      label={props.path}
      unplayable={
        <GitMediaUnavailable path={props.path} description="Glade can't play this video format." />
      }
      className="min-h-full"
    />
  ) : (
    <div className="local-image-preview min-h-full">
      <img
        src={url}
        onError={() => setFailedUrl(url)}
        alt={props.path}
        className="local-image-preview__img max-h-[calc(100vh-13rem)]"
      />
    </div>
  );
}
