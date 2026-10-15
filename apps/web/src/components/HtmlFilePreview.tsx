import { sandboxedHtmlHead } from "@glade/shared/attachments/sandboxedHtmlDocument";
import { useState } from "react";
import { SandboxedHtmlFrame } from "./SandboxedHtmlFrame";

// The policy must be the first element of the head, ahead of every authored token. Parsing keeps
// authored documents intact (doctype, head, attributes) instead of wrapping them in a body.
function htmlFileDocument(html: string, channel: string): string {
  const parsed = new DOMParser().parseFromString(html, "text/html");
  parsed.head.insertAdjacentHTML("afterbegin", sandboxedHtmlHead(channel));
  return `${parsed.doctype ? "<!doctype html>" : ""}${parsed.documentElement.outerHTML}`;
}

export function HtmlFilePreview({ html, title }: { html: string; title: string }) {
  const [channel] = useState(() => crypto.randomUUID());
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <SandboxedHtmlFrame
        key={html}
        document={htmlFileDocument(html, channel)}
        channel={channel}
        title={title}
        className="bg-white"
        style={{ colorScheme: "light" }}
      />
    </div>
  );
}
