import {
  PROVIDER_SEND_TURN_MAX_ATTACHMENTS,
  PROVIDER_SEND_TURN_MAX_IMAGE_BYTES,
} from "@glade/contracts/orchestration/threadEntities";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  type ComposerImageAttachment,
  PersistedComposerImageAttachment,
} from "../composerDraftDomain";
import * as composerImageBlobStore from "./composerImageBlobStore";
import {
  buildComposerFileAttachmentsFromFiles,
  stageUploadComposerAttachments,
  findPendingBlobComposerAttachments,
  hydratePendingBlobComposerAttachments,
  readFileAsDataUrl,
  prepareComposerImageAttachmentsFromFiles,
} from "./composerSend";
import { effectiveComposerAttachmentCount } from "./composerAttachmentCapacity";

const ATTACHMENT_IDS = [
  "thread-1-11111111-1111-4111-8111-111111111111",
  "thread-1-22222222-2222-4222-8222-222222222222",
];

function pngFile(name: string): File {
  return new File([name], name, { type: "image/png" });
}

function draftImage(file: File, index: number): ComposerImageAttachment {
  return {
    type: "image",
    id: `draft-${index}`,
    name: file.name,
    mimeType: file.type,
    sizeBytes: file.size,
    previewUrl: `blob:${file.name}`,
    file,
  };
}

function uploadedResponse(file: File, id: string): Response {
  return Response.json(
    { type: "image", id, name: file.name, mimeType: file.type, sizeBytes: file.size },
    { status: 201 },
  );
}

function stageImages(files: readonly File[]) {
  return stageUploadComposerAttachments({
    threadId: "thread-1",
    images: files.map(draftImage),
    files: [],
    assistantSelections: [],
  });
}

describe("composerSend attachment builders", () => {
  const originalCreateObjectUrl = URL.createObjectURL;

  beforeEach(() => {
    URL.createObjectURL = vi.fn((file: Blob) => `blob:${(file as File).name}`);
  });

  afterEach(() => {
    URL.createObjectURL = originalCreateObjectUrl;
    vi.unstubAllGlobals();
  });

  it("keeps image-specific unsupported-file errors while sharing cap handling", async () => {
    const textFile = new File(["hello"], "notes.txt", { type: "text/plain" });
    const imageFile = new File(["png"], "screen.png", { type: "image/png" });

    const result = await prepareComposerImageAttachmentsFromFiles({
      files: [textFile, imageFile],
      existingAttachmentCount: 0,
    });

    expect(result.error).toBe(
      "Unsupported file type for 'notes.txt'. Please attach image files only.",
    );
    expect(result.images).toEqual([
      expect.objectContaining({
        type: "image",
        name: "screen.png",
        mimeType: "image/png",
        previewUrl: "blob:screen.png",
      }),
    ]);
  });

  it("builds generic file attachments and skips images without an error", () => {
    const imageFile = new File(["png"], "screen.png", { type: "image/png" });
    const unknownFile = new File(["data"], "payload.bin", { type: "" });

    const result = buildComposerFileAttachmentsFromFiles({
      files: [imageFile, unknownFile],
      existingAttachmentCount: 0,
    });

    expect(result.error).toBeNull();
    expect(result.files).toEqual([
      expect.objectContaining({
        type: "file",
        name: "payload.bin",
        mimeType: "application/octet-stream",
        sizeBytes: unknownFile.size,
        file: unknownFile,
      }),
    ]);
  });

  it("enforces the shared attachment count cap for generic files", () => {
    const result = buildComposerFileAttachmentsFromFiles({
      files: [new File(["data"], "notes.txt", { type: "text/plain" })],
      existingAttachmentCount: PROVIDER_SEND_TURN_MAX_ATTACHMENTS,
    });

    expect(result.files).toEqual([]);
    expect(result.error).toBe(
      `You can attach up to ${PROVIDER_SEND_TURN_MAX_ATTACHMENTS} references per message.`,
    );
  });

  it("does not consume an attachment slot when oversized image preparation fails", async () => {
    const unsupported = new File(["gif"], "animation.gif", { type: "image/gif" });
    Object.defineProperty(unsupported, "size", {
      configurable: true,
      value: PROVIDER_SEND_TURN_MAX_IMAGE_BYTES + 1,
    });
    const valid = new File(["png"], "screen.png", { type: "image/png" });

    const result = await prepareComposerImageAttachmentsFromFiles({
      files: [unsupported, valid],
      existingAttachmentCount: PROVIDER_SEND_TURN_MAX_ATTACHMENTS - 1,
    });

    expect(result.images).toHaveLength(1);
    expect(result.images[0]?.file).toBe(valid);
    expect(result.error).toContain("cannot be optimized automatically");
  });

  it("reads genuine empty files instead of treating them as folders", async () => {
    vi.stubGlobal(
      "FileReader",
      class {
        result: string | null = null;
        error: Error | null = null;
        private readonly listeners = new Map<string, Array<() => void>>();

        addEventListener(type: string, listener: () => void) {
          const listeners = this.listeners.get(type) ?? [];
          listeners.push(listener);
          this.listeners.set(type, listeners);
        }

        readAsDataURL() {
          this.result = "data:application/octet-stream;base64,";
          for (const listener of this.listeners.get("load") ?? []) {
            listener();
          }
        }
      },
    );

    await expect(readFileAsDataUrl(new File([], ".gitkeep"))).resolves.toBe(
      "data:application/octet-stream;base64,",
    );
  });

  it("uploads binary files outside RPC and returns persisted attachment ids", async () => {
    const imageFile = pngFile("screen.png");
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(uploadedResponse(imageFile, ATTACHMENT_IDS[0]!));
    vi.stubGlobal("fetch", fetchMock);

    const { attachments } = await stageImages([imageFile]);

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/attachments/upload?"),
      expect.objectContaining({ method: "POST", body: imageFile }),
    );
    expect(attachments).toEqual([expect.objectContaining({ id: ATTACHMENT_IDS[0] })]);
  });

  it.each([
    ["succeeds", () => Promise.resolve(Response.json({ cancelled: true }, { status: 200 }))],
    ["fails", () => Promise.reject(new Error("Cancellation transport failed."))],
  ])(
    "cancels an earlier staged attachment and keeps the upload failure when cancellation %s",
    async (_case, cancel) => {
      const files = [pngFile("one.png"), pngFile("two.png")];
      const fetchMock = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(uploadedResponse(files[0]!, ATTACHMENT_IDS[0]!))
        .mockResolvedValueOnce(Response.json({ error: "Second upload failed." }, { status: 507 }))
        .mockImplementationOnce(cancel);
      vi.stubGlobal("fetch", fetchMock);

      await expect(stageImages(files)).rejects.toThrow("Second upload failed.");

      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(fetchMock.mock.calls[2]).toEqual([
        expect.stringContaining("/api/attachments/cancel"),
        expect.objectContaining({
          method: "POST",
          credentials: "include",
          body: JSON.stringify({ attachmentId: ATTACHMENT_IDS[0] }),
        }),
      ]);
    },
  );

  it("cancels every staged managed attachment when dispatch rejects", async () => {
    const files = [pngFile("one.png"), pngFile("two.png")];
    const fetchMock = vi.fn<typeof fetch>();
    for (const [index, file] of files.entries()) {
      fetchMock.mockResolvedValueOnce(uploadedResponse(file, ATTACHMENT_IDS[index]!));
    }
    fetchMock.mockResolvedValue(Response.json({ cancelled: true }, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const staged = await stageImages(files);
    const dispatchError = new Error("Dispatch rejected.");

    await expect(staged.runWithDispatch(async () => Promise.reject(dispatchError))).rejects.toBe(
      dispatchError,
    );

    expect(fetchMock).toHaveBeenCalledTimes(4);
    const cancelledIds = fetchMock.mock.calls
      .slice(2)
      .map(([, options]) => JSON.parse(String(options?.body)).attachmentId)
      .toSorted();
    expect(cancelledIds).toEqual(ATTACHMENT_IDS.toSorted());
  });

  it("commits successful dispatches so later cleanup does not cancel", async () => {
    const imageFile = pngFile("screen.png");
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(uploadedResponse(imageFile, ATTACHMENT_IDS[0]!));
    vi.stubGlobal("fetch", fetchMock);
    const staged = await stageImages([imageFile]);

    await expect(staged.runWithDispatch(async () => "accepted")).resolves.toBe("accepted");
    await staged.cleanup();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("effectiveComposerAttachmentCount", () => {
  it.each([
    {
      name: "counts live images, files, and assistant selections",
      persistedAttachments: [],
      assistantSelections: [{}],
      expected: 4,
    },
    {
      name: "counts a hydrated persisted image once and a pending one separately",
      persistedAttachments: [{ id: "image-1" }, { id: "pending-2" }],
      assistantSelections: [],
      expected: 4,
    },
  ])("$name", ({ persistedAttachments, assistantSelections, expected }) => {
    expect(
      effectiveComposerAttachmentCount({
        images: [{ id: "image-1" }, { id: "image-2" }],
        files: [{}],
        assistantSelections,
        persistedAttachments,
      }),
    ).toBe(expected);
  });
});

function persistedImageAttachment(
  overrides: Partial<PersistedComposerImageAttachment> = {},
): PersistedComposerImageAttachment {
  return {
    id: "image-1",
    name: "capture.png",
    mimeType: "image/png",
    sizeBytes: 4,
    blobKey: "thread-1:image-1",
    ...overrides,
  };
}

function composerImageAttachment(
  overrides: Partial<ComposerImageAttachment> = {},
): ComposerImageAttachment {
  const file = new File(["png"], "capture.png", { type: "image/png" });
  return {
    type: "image",
    id: "image-1",
    name: "capture.png",
    mimeType: "image/png",
    sizeBytes: 4,
    previewUrl: "blob:capture.png",
    file,
    ...overrides,
  };
}

describe("findPendingBlobComposerAttachments", () => {
  it("returns blob-backed persisted attachments not yet hydrated into images", () => {
    const pending = persistedImageAttachment({ id: "pending-1" });
    const hydrated = persistedImageAttachment({ id: "hydrated-1" });
    const { blobKey: _blobKey, ...inline } = persistedImageAttachment({
      id: "inline-1",
      dataUrl: "data:x",
    });

    const result = findPendingBlobComposerAttachments({
      persistedAttachments: [pending, hydrated, inline],
      images: [composerImageAttachment({ id: "hydrated-1" })],
    });

    expect(result).toEqual([pending]);
  });
});

describe("hydratePendingBlobComposerAttachments", () => {
  const originalCreateObjectUrl = URL.createObjectURL;

  beforeEach(() => {
    URL.createObjectURL = vi.fn((file: Blob) => `blob:${(file as File).name}`);
  });

  afterEach(() => {
    URL.createObjectURL = originalCreateObjectUrl;
    vi.restoreAllMocks();
  });

  it("reconstructs a ComposerImageAttachment from the stored blob", async () => {
    const blobFile = new File(["png"], "capture.png", { type: "image/png" });
    vi.spyOn(composerImageBlobStore, "readComposerImageBlob").mockResolvedValue(blobFile);

    const result = await hydratePendingBlobComposerAttachments([persistedImageAttachment({})]);

    expect(result).toEqual([
      expect.objectContaining({
        type: "image",
        id: "image-1",
        previewUrl: "blob:capture.png",
        file: blobFile,
      }),
    ]);
  });

  it("skips attachments whose blob is missing or unreadable without blocking the rest", async () => {
    vi.spyOn(composerImageBlobStore, "readComposerImageBlob")
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(new File(["png"], "ok.png", { type: "image/png" }));

    const result = await hydratePendingBlobComposerAttachments([
      persistedImageAttachment({ id: "broken" }),
      persistedImageAttachment({ id: "missing", blobKey: "thread-1:missing" }),
      persistedImageAttachment({ id: "ok", blobKey: "thread-1:ok" }),
    ]);

    expect(result).toEqual([expect.objectContaining({ id: "ok" })]);
  });
});
