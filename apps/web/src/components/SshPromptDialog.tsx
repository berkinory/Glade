import type { DesktopSshPrompt } from "@glade/contracts/ipc/sshHosts";
import { useEffect, useState } from "react";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "./ui/dialog";
import { Input } from "./ui/input";

function titleOf(prompt: DesktopSshPrompt): string {
  switch (prompt.kind) {
    case "host-key":
      return `Trust ${prompt.hostLabel}?`;
    case "password":
      return `Sign in to ${prompt.hostLabel}`;
    case "passphrase":
      return "Unlock your SSH key";
    case "secret":
      return `${prompt.hostLabel} asks for an answer`;
  }
}

// The questions ssh asks while Glade connects to a host. Host keys show ssh's own text with the
// fingerprint, so the user can compare it with the host's real key before trusting it.
export function SshPromptDialog() {
  const [prompts, setPrompts] = useState<ReadonlyArray<DesktopSshPrompt>>([]);
  const [answer, setAnswer] = useState("");
  const prompt = prompts[0] ?? null;

  useEffect(() => window.desktopBridge?.sshHosts?.onPrompts(setPrompts), []);
  useEffect(() => setAnswer(""), [prompt?.id]);

  if (!prompt) return null;
  const respond = (value: string | null) =>
    void window.desktopBridge?.sshHosts?.answerPrompt(prompt.id, value);
  const hostKey = prompt.kind === "host-key";

  return (
    <Dialog open onOpenChange={(open) => !open && respond(null)}>
      <DialogPopup className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{titleOf(prompt)}</DialogTitle>
          {hostKey ? (
            <DialogDescription>
              Glade has not connected to this host before. Trust it only if this fingerprint matches
              the host's key.
            </DialogDescription>
          ) : null}
        </DialogHeader>
        <DialogPanel>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              respond(hostKey ? "yes" : answer);
            }}
          >
            {hostKey ? (
              <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded-md bg-muted p-3 font-mono text-ui-xs">
                {prompt.message}
              </pre>
            ) : (
              <>
                <p className="mb-2 text-ui-sm text-muted-foreground">{prompt.message}</p>
                <Input
                  aria-label={prompt.message}
                  type="password"
                  size="lg"
                  autoFocus
                  autoComplete="off"
                  value={answer}
                  onChange={(event) => setAnswer(event.target.value)}
                />
              </>
            )}
          </form>
        </DialogPanel>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => respond(null)}>
            Cancel
          </Button>
          <Button
            size="sm"
            autoFocus={hostKey}
            disabled={!hostKey && answer.length === 0}
            onClick={() => respond(hostKey ? "yes" : answer)}
          >
            {hostKey ? "Trust and connect" : "Continue"}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
