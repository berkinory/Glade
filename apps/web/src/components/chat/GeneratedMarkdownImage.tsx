import { DownloadIcon, ArrowExpandIcon } from "~/lib/icons";
import { Spinner } from "~/components/ui/spinner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type MouseEvent, useEffect, useRef, useState } from "react";
import { buildLocalImageUrl, localImageAbsolutePath } from "~/lib/localImageUrls";
import {
  isLocalPreviewGrantUsable,
  projectLocalPreviewGrantQueryOptions,
} from "~/lib/projectReactQuery";
import {
  LocalImageErrorCard,
  useLocalImageDownloadClick,
  useLocalImagePreview,
} from "../LocalImagePreview";
import type { ExpandedImagePreview } from "./ExpandedImagePreview";
import { toastManager } from "../ui/toast";
export interface GeneratedMarkdownImageProps {
  linked?: boolean;
  src: string;
  alt: string;
  cwd: string | undefined;
  onImageExpand?: ((preview: ExpandedImagePreview) => void) | undefined;
}
function stopPropagation(event: MouseEvent<HTMLElement>) {
  event.stopPropagation();
}
export function GeneratedMarkdownImage(props: GeneratedMarkdownImageProps) {
  return <GeneratedMarkdownImageContent key={JSON.stringify([props.src, props.cwd])} {...props} />;
}
function GeneratedMarkdownImageContent(props: GeneratedMarkdownImageProps) {
  const { src, alt, cwd, onImageExpand } = props;
  const queryClient = useQueryClient();
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const absolutePath = localImageAbsolutePath(src);
  const [needsGrant, setNeedsGrant] = useState(false);
  const [previewGrant, setPreviewGrant] = useState<string>();
  const grantOptions = projectLocalPreviewGrantQueryOptions({
    path: absolutePath,
    enabled: needsGrant && absolutePath !== null && previewGrant === undefined,
    // An HTTP denial must not reuse a token invalidated by a server restart.
    staleTime: 0,
  });
  const retryGrant = (failureCount: number, error: unknown) =>
    failureCount < 2 &&
    typeof error === "object" &&
    error !== null &&
    "retryable" in error &&
    error.retryable === true;
  const grantQuery = useQuery({
    ...grantOptions,
    retry: retryGrant,
    refetchInterval: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  useEffect(() => {
    if (
      needsGrant &&
      previewGrant === undefined &&
      !grantQuery.isFetching &&
      grantQuery.isSuccess &&
      isLocalPreviewGrantUsable(grantQuery.data)
    ) {
      // Freeze the loaded preview. Another file pane may renew the same cache entry; that must not make
      // historical chat images download again.
      setPreviewGrant(grantQuery.data.grant);
    }
  }, [needsGrant, previewGrant, grantQuery.data, grantQuery.isFetching, grantQuery.isSuccess]);
  const { previewUrl, downloadUrl, fileName, downloadName, status, imgProps } =
    useLocalImagePreview({
      src,
      cwd,
      previewGrant,
      onPreviewError: () => {
        if (absolutePath !== null) setNeedsGrant(true);
      },
    });
  const resolvingGrant =
    needsGrant &&
    !previewGrant &&
    (grantQuery.isFetching || (grantQuery.isSuccess && isLocalPreviewGrantUsable(grantQuery.data)));
  const resolveGrantedUrl = async (download: boolean) => {
    if (!needsGrant || absolutePath === null) return download ? downloadUrl : previewUrl;
    const grant = await queryClient.fetchQuery({
      ...grantOptions,
      retry: retryGrant,
    });
    return buildLocalImageUrl({
      src,
      cwd,
      download,
      grant: grant.grant,
    });
  };
  const accessibleName = alt?.trim() || "Generated image";
  const downloadImage = useLocalImageDownloadClick({
    downloadUrl,
    downloadName,
    errorTitle: "Could not download generated image",
    resolveDownloadUrl: () => resolveGrantedUrl(true),
  });
  const expandImage = (event: MouseEvent<HTMLElement>) => {
    event.preventDefault();
    if (status === "error") {
      return;
    }
    if (!onImageExpand) return;
    if (!needsGrant) {
      onImageExpand({
        images: [
          {
            src: previewUrl,
            name: fileName || accessibleName,
          },
        ],
        index: 0,
      });
      return;
    }
    void resolveGrantedUrl(false)
      .then((url) => {
        if (mounted.current) {
          onImageExpand({
            images: [
              {
                src: url,
                name: fileName || accessibleName,
              },
            ],
            index: 0,
          });
        }
      })
      .catch((error: unknown) => {
        if (mounted.current) {
          toastManager.add({
            type: "error",
            title: "Could not open generated image",
            description: error instanceof Error ? error.message : "The file may be unavailable.",
          });
        }
      });
  };
  if (props.linked) {
    return (
      <span className="chat-generated-image">
        <img {...imgProps} alt={accessibleName} className="chat-generated-image__img" />
      </span>
    );
  }
  if (status === "error" && !resolvingGrant) {
    return (
      <LocalImageErrorCard
        downloadUrl={downloadUrl}
        downloadName={downloadName}
        className="local-image-error--prose"
        downloadAriaLabel="Download generated image"
        onDownloadClick={downloadImage}
      />
    );
  }
  return (
    <span className="chat-generated-image" data-status={resolvingGrant ? "loading" : status}>
      <button
        type="button"
        className="chat-generated-image__frame"
        onClick={expandImage}
        aria-label="Expand generated image"
      >
        {status === "loading" || resolvingGrant ? (
          <span className="chat-generated-image__skeleton" aria-hidden="true">
            <Spinner className="size-4 opacity-60" />
          </span>
        ) : null}
        <img {...imgProps} alt={accessibleName} className="chat-generated-image__img" />
        <span className="chat-generated-image__overlay" aria-hidden="true">
          <span className="chat-generated-image__overlay-pill chat-generated-image__overlay-pill--expand">
            <ArrowExpandIcon className="size-3.5" />
            <span>Expand</span>
          </span>
        </span>
      </button>
      <a
        href={downloadUrl}
        download={downloadName}
        onClick={downloadImage}
        onMouseDown={stopPropagation}
        className="chat-generated-image__overlay-pill chat-generated-image__overlay-pill--download"
        aria-label="Download generated image"
        title="Download"
      >
        <DownloadIcon className="size-3.5" aria-hidden="true" />
        <span>Download</span>
      </a>
    </span>
  );
}
