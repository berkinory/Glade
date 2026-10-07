import { BrowserFailure, withTimeout } from "../browserFailure";
import { click } from "./actions";
import type { CdpSession } from "./cdpSession";
import { rethrowStaleNode, type RefTable } from "./refs";

const CHOOSER_TIMEOUT_MS = 5_000;

interface DescribedNode {
  readonly node: { readonly localName?: string; readonly attributes?: readonly string[] };
}

function isFileInput({ node }: DescribedNode): boolean {
  const attributes = node.attributes ?? [];
  const typeIndex = attributes.findIndex((name, index) => index % 2 === 0 && name === "type");
  return node.localName === "input" && attributes[typeIndex + 1]?.toLowerCase() === "file";
}

// A ref on the <input type=file> itself is filled directly. Any other ref (a styled button or drop
// zone) is clicked with chooser interception armed first, because browsers only open choosers from
// real user activation; the intercepted chooser then receives the files.
export async function uploadFiles(
  cdp: CdpSession,
  refs: RefTable,
  input: { readonly ref: string; readonly paths: readonly string[] },
): Promise<string> {
  const target = refs.resolve(input.ref);
  const described = await cdp
    .send<DescribedNode>(
      "DOM.describeNode",
      { backendNodeId: target.backendNodeId },
      target.sessionId,
    )
    .catch(rethrowStaleNode(input.ref));
  const done = `Attached ${input.paths.length} file${input.paths.length === 1 ? "" : "s"} via ${input.ref}.`;
  if (isFileInput(described)) {
    await cdp.send(
      "DOM.setFileInputFiles",
      { files: input.paths, backendNodeId: target.backendNodeId },
      target.sessionId,
    );
    return done;
  }
  let release: () => void = () => undefined;
  const opened = new Promise<{ backendNodeId: number; sessionId: string | undefined }>(
    (resolve) => {
      release = cdp.on((method, params, sessionId) => {
        if (method === "Page.fileChooserOpened")
          resolve({ backendNodeId: params.backendNodeId, sessionId });
      });
    },
  );
  const sessions = [...new Set([undefined, target.sessionId])];
  const intercept = (enabled: boolean) =>
    Promise.all(
      sessions.map((sessionId) =>
        cdp.send("Page.setInterceptFileChooserDialog", { enabled }, sessionId),
      ),
    );
  try {
    await intercept(true);
    await click(cdp, refs, { ref: input.ref });
    const chooser = await withTimeout(
      opened,
      CHOOSER_TIMEOUT_MS,
      "Waiting for a file chooser",
    ).catch(() => {
      throw new BrowserFailure(
        "upload_failed",
        `Clicking ${input.ref} did not open a file chooser. Use the ref of the file input or its upload button.`,
      );
    });
    await cdp.send(
      "DOM.setFileInputFiles",
      { files: input.paths, backendNodeId: chooser.backendNodeId },
      chooser.sessionId,
    );
    return done;
  } finally {
    release();
    await intercept(false).catch(() => undefined);
  }
}
