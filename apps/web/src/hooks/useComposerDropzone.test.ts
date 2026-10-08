import { describe, expect, it, test } from "vitest";

import {
  collectComposerClipboardFiles,
  shouldPreventDefaultForUnhandledFileDrop,
  shouldHandleComposerDropzoneFiles,
  splitComposerDropzoneFiles,
} from "./useComposerDropzone";

describe("useComposerDropzone file capability helpers", () => {
  describe("clipboard file collection", () => {
    const clipboard = (files: File[], items: Array<Partial<DataTransferItem>>) =>
      ({ files, items }) as unknown as Pick<DataTransfer, "files" | "items">;
    const fileItem = (getAsFile: () => File | null, kind = "file") =>
      ({ kind, getAsFile }) as DataTransferItem;
    const image = (name = "image.png") => new File(["image"], name, { type: "image/png" });

    test.each([
      ["files-only existing path", [image()], [], ["image.png"]],
      ["items-only regression", [], [fileItem(() => image())], ["image.png"]],
      ["null file item", [], [fileItem(() => null)], []],
      ["non-file/text-only item", [], [fileItem(() => null, "string")], []],
    ])("collects %s", (_case, files, items, expectedNames) => {
      expect(
        collectComposerClipboardFiles(clipboard(files, items)).map(({ name }) => name),
      ).toEqual(expectedNames);
    });

    it("deduplicates duplicate file representations", () => {
      const listed = new File(["same"], "image.png", { type: "image/png", lastModified: 123 });
      const itemFile = new File(["same"], "image.png", { type: "image/png", lastModified: 123 });

      expect(
        collectComposerClipboardFiles(clipboard([listed], [fileItem(() => itemFile)])),
      ).toEqual([listed]);
    });

    it("keeps listed files when getAsFile throws", () => {
      const listed = image("listed.png");
      const throwingItem = fileItem(() => {
        throw new Error("clipboard access denied");
      });

      expect(collectComposerClipboardFiles(clipboard([listed], [throwingItem]))).toEqual([listed]);
    });
  });

  test.each([
    ["accept", true, true],
    ["reject", true, true],
    ["fallthrough", false, false],
  ] as const)(
    "applies %s policy to generic-only and unusable drops",
    (mode, handlesGeneric, preventsUnusable) => {
      const generic = new File(["text"], "notes.txt", { type: "text/plain" });

      expect(shouldHandleComposerDropzoneFiles(splitComposerDropzoneFiles([generic]), mode)).toBe(
        handlesGeneric,
      );
      expect(shouldPreventDefaultForUnhandledFileDrop(splitComposerDropzoneFiles([]), mode)).toBe(
        preventsUnusable,
      );
    },
  );
});
