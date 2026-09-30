import {
  type BrowserAutomationError,
  type BrowserAutomationErrorInput,
  type BrowserMcpToolErrorEnvelope,
} from "@glade/contracts/browser/automation/browserAutomationErrors";
import { makeBrowserMcpToolErrorEnvelope } from "@glade/shared/browser/browserAutomationErrors";

export class BrowserAutomationHostError extends Error {
  readonly envelope: BrowserMcpToolErrorEnvelope;

  constructor(input: BrowserAutomationErrorInput) {
    const envelope = makeBrowserMcpToolErrorEnvelope(input);
    super(envelope.error.message);
    this.name = "BrowserAutomationHostError";
    this.envelope = envelope;
  }

  get browserError(): BrowserAutomationError {
    return this.envelope.error;
  }
}

export function browserHostError(input: BrowserAutomationErrorInput): never {
  throw new BrowserAutomationHostError(input);
}
