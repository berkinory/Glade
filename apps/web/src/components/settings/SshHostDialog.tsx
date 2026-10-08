import type { DesktopSshHost, DesktopSshHostInput } from "@glade/contracts/ipc/sshHosts";
import { useEffect, useId, useState } from "react";
import { ChevronRightIcon } from "~/lib/icons";
import { cn } from "~/lib/utils";
import { PROJECT_DIALOG_FIELD_CONTROL_CLASS_NAME } from "../CreateGitHubProjectFields";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
  dialogFieldLabelClassName,
} from "../ui/dialog";
import { DisclosureRegion } from "../ui/DisclosureRegion";
import { Input } from "../ui/input";

function parseOptionalPort(value: string): number | null | "invalid" {
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  const port = Number(trimmed);
  return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : "invalid";
}

function validate(input: {
  destination: string;
  port: string;
  identityFile: string;
}): string | null {
  if (input.destination.length === 0) return "Enter the host to connect to.";
  if (/\s/u.test(input.destination) || input.destination.startsWith("-")) {
    return "Enter a destination like user@example.com or a Host alias from ~/.ssh/config.";
  }
  if (parseOptionalPort(input.port) === "invalid")
    return "The port must be a number from 1 to 65535.";
  if (input.identityFile.length > 0 && !/^(~\/|\/)/u.test(input.identityFile)) {
    return "The key file must be an absolute path or start with ~/.";
  }
  return null;
}

const FIELD_LABEL_CLASS_NAME = cn("block", dialogFieldLabelClassName, "text-ui text-foreground");

// Adds a host, or edits a saved one. Port and key file are rarely needed with an SSH config, so they
// wait behind "Advanced" unless the host already uses them.
export function SshHostDialog(props: {
  readonly open: boolean;
  readonly host: DesktopSshHost | null;
  readonly suggestions: ReadonlyArray<string>;
  readonly onOpenChange: (open: boolean) => void;
  readonly onSave: (input: DesktopSshHostInput) => Promise<void>;
}) {
  const { host } = props;
  const fieldId = useId();
  const [destination, setDestination] = useState("");
  const [label, setLabel] = useState("");
  const [port, setPort] = useState("");
  const [identityFile, setIdentityFile] = useState("");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!props.open) return;
    setDestination(host?.destination ?? "");
    setLabel(host?.label ?? "");
    setPort(host?.port === null || host?.port === undefined ? "" : String(host.port));
    setIdentityFile(host?.identityFile ?? "");
    setAdvancedOpen(host !== null && (host.port !== null || host.identityFile !== null));
    setPending(false);
    setError(null);
  }, [host, props.open]);

  const submit = async () => {
    const fields = {
      destination: destination.trim(),
      port: port.trim(),
      identityFile: identityFile.trim(),
    };
    const problem = validate(fields);
    if (problem) {
      setError(problem);
      return;
    }
    const parsedPort = parseOptionalPort(fields.port);
    setPending(true);
    setError(null);
    try {
      await props.onSave({
        ...(host ? { id: host.id } : {}),
        label: label.trim() || fields.destination,
        destination: fields.destination,
        port: parsedPort === "invalid" ? null : parsedPort,
        identityFile: fields.identityFile.length > 0 ? fields.identityFile : null,
      });
      props.onOpenChange(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save the host.");
      setPending(false);
    }
  };

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogPopup>
        <DialogHeader className="px-5 pt-5">
          <DialogTitle>{host ? `Edit ${host.label}` : "Add SSH host"}</DialogTitle>
          <DialogDescription>
            {host
              ? "A new address may reach another machine; Glade then asks you to add it as a new host."
              : "Glade connects with your system ssh and installs its server on the host the first time. Projects and chats there stay on the host."}
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="space-y-4 px-5">
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            <div className="space-y-2">
              <label htmlFor={`${fieldId}-destination`} className={FIELD_LABEL_CLASS_NAME}>
                Host
              </label>
              <Input
                id={`${fieldId}-destination`}
                className={PROJECT_DIALOG_FIELD_CONTROL_CLASS_NAME}
                autoFocus
                autoComplete="off"
                spellCheck={false}
                placeholder={props.suggestions[0] ?? "user@hostname"}
                value={destination}
                aria-invalid={error ? true : undefined}
                onChange={(event) => {
                  setDestination(event.target.value);
                  setError(null);
                }}
              />
              {!host && props.suggestions.length > 0 ? (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-ui-xs text-muted-foreground">From ~/.ssh/config:</span>
                  {props.suggestions.map((alias) => (
                    <Button
                      key={alias}
                      type="button"
                      size="xs"
                      variant={destination.trim() === alias ? "secondary" : "outline"}
                      className="font-mono"
                      onClick={() => {
                        setDestination(alias);
                        setError(null);
                      }}
                    >
                      {alias}
                    </Button>
                  ))}
                </div>
              ) : null}
            </div>
            <div className="space-y-2">
              <label htmlFor={`${fieldId}-label`} className={FIELD_LABEL_CLASS_NAME}>
                Name
              </label>
              <Input
                id={`${fieldId}-label`}
                className={PROJECT_DIALOG_FIELD_CONTROL_CLASS_NAME}
                placeholder={destination.trim() || props.suggestions[0] || "Name in the sidebar"}
                value={label}
                onChange={(event) => setLabel(event.target.value)}
              />
            </div>
            <div>
              <button
                type="button"
                aria-expanded={advancedOpen}
                className="flex items-center gap-1 text-ui-sm text-muted-foreground hover:text-foreground"
                onClick={() => setAdvancedOpen((open) => !open)}
              >
                <ChevronRightIcon
                  aria-hidden
                  className={cn("size-3.5 transition-transform", advancedOpen && "rotate-90")}
                />
                Advanced
              </button>
              <DisclosureRegion open={advancedOpen}>
                <div className="grid grid-cols-[6rem_1fr] gap-3 pt-3">
                  <div className="space-y-2">
                    <label htmlFor={`${fieldId}-port`} className={FIELD_LABEL_CLASS_NAME}>
                      Port
                    </label>
                    <Input
                      id={`${fieldId}-port`}
                      className={PROJECT_DIALOG_FIELD_CONTROL_CLASS_NAME}
                      inputMode="numeric"
                      placeholder="22"
                      value={port}
                      onChange={(event) => {
                        setPort(event.target.value);
                        setError(null);
                      }}
                    />
                  </div>
                  <div className="space-y-2">
                    <label htmlFor={`${fieldId}-key`} className={FIELD_LABEL_CLASS_NAME}>
                      Key file
                    </label>
                    <Input
                      id={`${fieldId}-key`}
                      className={PROJECT_DIALOG_FIELD_CONTROL_CLASS_NAME}
                      autoComplete="off"
                      spellCheck={false}
                      placeholder="SSH agent or config"
                      value={identityFile}
                      onChange={(event) => {
                        setIdentityFile(event.target.value);
                        setError(null);
                      }}
                    />
                  </div>
                </div>
              </DisclosureRegion>
            </div>
            {/* Lets Enter submit from any field. */}
            <button type="submit" hidden />
          </form>
          {error ? (
            <p role="alert" className="text-ui-xs text-destructive">
              {error}
            </p>
          ) : null}
        </DialogPanel>
        <DialogFooter className="px-5 pb-5">
          <Button
            variant="ghost"
            shape="capsule"
            className="px-4 text-ui-lg sm:text-ui-lg"
            onClick={() => props.onOpenChange(false)}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button
            variant="prominent"
            className="px-4 text-ui-lg transition-opacity hover:scale-100 sm:text-ui-lg"
            onClick={() => void submit()}
            disabled={pending || destination.trim().length === 0}
          >
            {pending ? "Saving…" : host ? "Save" : "Add and connect"}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
