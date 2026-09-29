import type { Terminal } from "@xterm/xterm";

// Suppress only response sequences whose final byte differs from their query so real commands
// cannot be consumed.
export function suppressQueryResponses(terminal: Terminal): () => void {
  const disposables: { dispose(): void }[] = [];
  const p = terminal.parser;

  disposables.push(p.registerCsiHandler({ final: "R" }, () => true));
  disposables.push(p.registerCsiHandler({ final: "I" }, () => true));
  disposables.push(p.registerCsiHandler({ final: "O" }, () => true));
  disposables.push(p.registerCsiHandler({ intermediates: "$", final: "y" }, () => true));

  return () => {
    for (const d of disposables) d.dispose();
  };
}
