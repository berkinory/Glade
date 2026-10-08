import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { downloadUrlAsBlob } from "./browserDownload";

describe("browserDownload", () => {
  const originalDocument = globalThis.document;
  const originalFetch = globalThis.fetch;
  const originalCreateObjectUrl = URL.createObjectURL;
  const originalRevokeObjectUrl = URL.revokeObjectURL;
  let click: ReturnType<typeof vi.fn>;
  let appended: unknown[] = [];
  let link: {
    href: string;
    download: string;
    click: ReturnType<typeof vi.fn>;
    remove: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    click = vi.fn();
    appended = [];
    link = {
      href: "",
      download: "",
      click,
      remove: vi.fn(),
    };
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: {
        createElement: vi.fn((tagName: string) => {
          if (tagName !== "a") throw new Error(`Unexpected element ${tagName}`);
          return link;
        }),
        body: {
          appendChild: vi.fn((node: unknown) => {
            appended.push(node);
            return node;
          }),
        },
      },
    });
    URL.createObjectURL = vi.fn(() => "blob:download");
    URL.revokeObjectURL = vi.fn();
  });

  afterEach(() => {
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: originalDocument,
    });
    globalThis.fetch = originalFetch;
    URL.createObjectURL = originalCreateObjectUrl;
    URL.revokeObjectURL = originalRevokeObjectUrl;
  });

  it.each([
    {
      name: "falls back to the caller filename without",
      disposition: null,
      expected: "fallback.zip",
    },
    {
      name: "prefers the server filename from",
      disposition: 'attachment; filename="glade-thread-pretty.zip"',
      expected: "glade-thread-pretty.zip",
    },
    {
      name: "falls back to the caller filename for a malformed",
      disposition: "attachment; filename=",
      expected: "fallback.zip",
    },
  ])("$name Content-Disposition", async ({ disposition, expected }) => {
    const url = "http://127.0.0.1:5733/api/thread-export?threadId=thread-1";
    globalThis.fetch = vi.fn(() =>
      Promise.resolve(
        new Response("zip", {
          status: 200,
          headers: disposition ? { "Content-Disposition": disposition } : {},
        }),
      ),
    );

    await downloadUrlAsBlob({ url, filename: "fallback.zip" });

    expect(globalThis.fetch).toHaveBeenCalledWith(url);
    expect(URL.createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
    expect(link.href).toBe("blob:download");
    expect(link.download).toBe(expected);
    expect(appended).toEqual([link]);
    expect(click).toHaveBeenCalledTimes(1);
    expect(link.remove).toHaveBeenCalledTimes(1);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:download");
  });

  it("surfaces the response body reason when the server blocks the download", async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve(
        new Response("Thread is still running. Wait for the current turn to finish.", {
          status: 409,
          statusText: "Conflict",
        }),
      ),
    );

    await expect(
      downloadUrlAsBlob({
        url: "http://127.0.0.1:5733/api/thread-export?threadId=thread-1",
        filename: "glade-thread-thread-1.zip",
      }),
    ).rejects.toThrow(
      "Download failed with HTTP 409 Conflict. Thread is still running. Wait for the current turn to finish.",
    );

    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(click).not.toHaveBeenCalled();
  });
});
