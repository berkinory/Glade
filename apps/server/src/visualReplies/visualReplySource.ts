import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { constants } from "node:fs";
import { parse, serialize, type DefaultTreeAdapterTypes } from "parse5";
import { Data, Effect } from "effect";
import {
  VISUAL_REPLY_MAX_SOURCE_BYTES,
  VISUAL_REPLY_MAX_DOCUMENT_BYTES,
  type VisualReplyInput,
} from "@glade/contracts/orchestration/visualReply";
import { isWorkspaceRootWithin } from "@glade/shared/threads/threadWorkspace";

export class VisualReplyError extends Data.TaggedError("VisualReplyError")<{
  readonly message: string;
}> {}

type Element = DefaultTreeAdapterTypes.Element;
type Node = DefaultTreeAdapterTypes.Node;

async function readWorkspaceFile(root: string, requested: string, maxBytes: number) {
  const canonicalRoot = await fs.realpath(root);
  const resolved = await fs.realpath(path.resolve(canonicalRoot, requested));
  if (!isWorkspaceRootWithin(resolved, canonicalRoot))
    throw new Error("File is outside the caller workspace.");
  const handle = await fs.open(resolved, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > maxBytes)
      throw new Error("File is not a bounded regular file.");
    const bytes = Buffer.alloc(maxBytes + 1);
    let length = 0;
    while (length < bytes.length) {
      const result = await handle.read(bytes, length, bytes.length - length, length);
      if (result.bytesRead === 0) break;
      length += result.bytesRead;
    }
    if (length > maxBytes) throw new Error("File exceeds the visual reply size limit.");
    return { bytes: bytes.subarray(0, length), resolved };
  } finally {
    await handle.close();
  }
}

function rasterMime(bytes: Buffer): string | null {
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
    return "image/png";
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return "image/jpeg";
  const prefix = bytes.subarray(0, 6).toString("ascii");
  if (prefix === "GIF87a" || prefix === "GIF89a") return "image/gif";
  if (
    bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
    bytes.subarray(8, 12).toString("ascii") === "WEBP"
  )
    return "image/webp";
  return null;
}

function elements(node: Node): Element[] {
  const result: Element[] = [];
  const pending: Node[] = [node];
  while (pending.length > 0) {
    const next = pending.pop()!;
    if ("tagName" in next) result.push(next);
    if ("childNodes" in next) for (const child of next.childNodes) pending.push(child);
    if ("content" in next) pending.push(next.content);
  }
  return result;
}

export const prepareVisualReply = (input: {
  readonly source: VisualReplyInput;
  readonly workspaceRoot: string | null;
}) =>
  Effect.tryPromise({
    try: async () => {
      const { source } = input;
      if ((source.html === undefined) === (source.path === undefined))
        throw new Error("Provide exactly one of html or path.");
      const root = input.workspaceRoot;
      if (source.path !== undefined && root === null)
        throw new Error("A ready caller workspace is required for file-based visuals.");
      const file =
        source.path === undefined || root === null
          ? null
          : await readWorkspaceFile(root, source.path, VISUAL_REPLY_MAX_SOURCE_BYTES);
      const html = file?.bytes.toString("utf8") ?? source.html ?? "";
      if (!html.trim() || Buffer.byteLength(html) > VISUAL_REPLY_MAX_SOURCE_BYTES)
        throw new Error("HTML is empty or exceeds 2 MiB.");
      const document = parse(html);
      const baseDir = file ? path.dirname(file.resolved) : root;
      let embeddedBytes = 0;
      for (const node of elements(document)) {
        if (node.tagName === "a" || node.tagName === "area") {
          node.attrs = node.attrs.filter(
            (attr) =>
              attr.name !== "href" ||
              attr.value.startsWith("#") ||
              /^https?:\/\//iu.test(attr.value),
          );
        }
        if (
          node.tagName === "base" ||
          (node.tagName === "meta" && node.attrs.some((attr) => attr.name === "http-equiv"))
        ) {
          const parent = node.parentNode;
          if (parent) parent.childNodes = parent.childNodes.filter((child) => child !== node);
          continue;
        }
        if (node.tagName === "script" || node.tagName === "link") {
          const resource = node.attrs.find(
            (attr) => attr.name === (node.tagName === "script" ? "src" : "href"),
          );
          if (resource && !/^https?:\/\//iu.test(resource.value))
            throw new Error(
              "External scripts and styles must use absolute HTTP(S) URLs; inline local resources.",
            );
        }
        if (node.tagName !== "img") continue;
        const src = node.attrs.find((attr) => attr.name === "src");
        if (!src || src.value.startsWith("data:") || /^https?:\/\//iu.test(src.value)) continue;
        if (/^[a-z][a-z\d+.-]*:/iu.test(src.value) || src.value.startsWith("//"))
          throw new Error(
            "Images must be embedded data URLs or files inside the caller workspace.",
          );
        if (root === null || baseDir === null)
          throw new Error("A ready caller workspace is required for local image files.");
        const asset = await readWorkspaceFile(
          root,
          path.resolve(baseDir, src.value),
          8 * 1024 * 1024,
        );
        const mime = rasterMime(asset.bytes);
        if (!mime)
          throw new Error(
            "Local images must contain PNG, JPEG, GIF or WebP image bytes. Use inline SVG for diagrams.",
          );
        embeddedBytes += asset.bytes.byteLength;
        if (embeddedBytes > 8 * 1024 * 1024) throw new Error("Embedded images exceed 8 MiB.");
        src.value = `data:${mime};base64,${asset.bytes.toString("base64")}`;
        node.attrs = node.attrs.filter((attr) => attr.name !== "srcset");
      }
      const prepared = serialize(document);
      if (Buffer.byteLength(prepared) > VISUAL_REPLY_MAX_DOCUMENT_BYTES)
        throw new Error("Prepared HTML exceeds 16 MiB.");
      return { html: prepared, hash: createHash("sha256").update(prepared).digest("hex") };
    },
    catch: (cause) =>
      new VisualReplyError({
        message: cause instanceof Error ? cause.message : "Could not prepare visual reply.",
      }),
  });
