import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  createAttachmentId,
  parseThreadSegmentFromAttachmentId,
  resolveAttachmentPathById,
} from "./attachmentStore.ts";

describe("attachmentStore", () => {
  it("sanitizes and lowercases thread ids when creating attachment ids", () => {
    const attachmentId = createAttachmentId("Thread.Folder/unsafe space");
    expect(parseThreadSegmentFromAttachmentId(attachmentId!)).toBe("thread-folder-unsafe-space");
  });

  it("parses exact thread segments from attachment ids without prefix collisions", () => {
    const fooId = "foo-00000000-0000-4000-8000-000000000001";
    const fooBarId = "foo-bar-00000000-0000-4000-8000-000000000002";

    expect(parseThreadSegmentFromAttachmentId(fooId)).toBe("foo");
    expect(parseThreadSegmentFromAttachmentId(fooBarId)).toBe("foo-bar");
  });

  it("resolves attachment path by id using the extension that exists on disk", () => {
    const attachmentsDir = fs.mkdtempSync(path.join(os.tmpdir(), "glade-attachment-store-"));
    try {
      const attachmentId = "thread-1-attachment";
      const pngPath = path.join(attachmentsDir, `${attachmentId}.png`);
      fs.writeFileSync(pngPath, Buffer.from("hello"));

      expect(resolveAttachmentPathById({ attachmentsDir, attachmentId })).toBe(pngPath);
      expect(
        resolveAttachmentPathById({ attachmentsDir, attachmentId: "thread-1-missing" }),
      ).toBeNull();
    } finally {
      fs.rmSync(attachmentsDir, { recursive: true, force: true });
    }
  });
});
