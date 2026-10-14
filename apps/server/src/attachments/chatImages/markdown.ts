import { fromMarkdown } from "mdast-util-from-markdown";
import { Effect } from "effect";
import { isSupportedLocalImagePath } from "@glade/shared/attachments/localPreviewFiles";
import { chatImageSnapshotName } from "@glade/shared/attachments/chatImageSnapshots";
import { isWindowsAbsolutePath } from "@glade/shared/platform/path";

function localImageSource(url: string): string | null {
  if (chatImageSnapshotName(url) || url.startsWith("//")) return null;
  if (url.startsWith("file://")) {
    const parsed = URL.parse(url);
    if (!parsed || (parsed.hostname && parsed.hostname !== "localhost")) return null;
    url = parsed.pathname;
  } else if (!isWindowsAbsolutePath(url) && /^[a-z][a-z\d+.-]*:/i.test(url)) return null;
  try {
    url = decodeURIComponent(url);
  } catch {
    return null;
  }
  return isSupportedLocalImagePath(url) ? url : null;
}

export function preserveMarkdownImages<E>(
  text: string,
  preserve: (source: string) => Effect.Effect<string, E>,
) {
  return Effect.gen(function* () {
    if (!text.includes("![")) return text;
    const tree = fromMarkdown(text);
    const definitions = new Map<string, string>();
    type Node = (typeof tree.children)[number];
    const images: Array<{
      start: number;
      end: number;
      source: string;
      alt: string;
      title: string;
    }> = [];
    const visit = (node: Node | typeof tree, collect: boolean): void => {
      if (node.type === "definition") definitions.set(node.identifier, node.url);
      if (collect && (node.type === "image" || node.type === "imageReference")) {
        const url = node.type === "image" ? node.url : definitions.get(node.identifier);
        const source = url ? localImageSource(url) : null;
        const start = node.position?.start.offset;
        const end = node.position?.end.offset;
        if (source && start !== undefined && end !== undefined)
          images.push({
            start,
            end,
            source,
            alt: node.alt ?? "Image",
            // Native image replays match the original path even after the destination is frozen.
            title: node.type === "image" && node.title ? `${node.title} (${source})` : source,
          });
      }
      if ("children" in node) for (const child of node.children) visit(child, collect);
    };
    visit(tree, false);
    visit(tree, true);
    const saved = new Map<string, string | null>();
    for (const image of images) {
      if (!saved.has(image.source)) {
        const url = yield* preserve(image.source).pipe(
          Effect.catch((error) =>
            Effect.logWarning("could not preserve chat image", { error }).pipe(Effect.as(null)),
          ),
        );
        saved.set(image.source, url);
      }
    }
    for (const image of images.toReversed()) {
      const url = saved.get(image.source);
      const alt = image.alt.replace(/[\\[\]]/g, "\\$&");
      const replacement = url
        ? `![${alt}](<${url}> ${JSON.stringify(image.title)})`
        : `[${alt}: image could not be preserved](<${encodeURI(image.source).replaceAll(">", "%3E")}>)`;
      text = text.slice(0, image.start) + replacement + text.slice(image.end);
    }
    return text;
  });
}
