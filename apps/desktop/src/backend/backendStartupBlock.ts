import { StringDecoder } from "node:string_decoder";

const MAX_STARTUP_OUTPUT_CHARS = 16_384;

export interface BackendStartupBlock {
  readonly kind: "database-locked";
  readonly ownerPid: number | null;
}

export class BackendStartupBlockDetector {
  private output = "";
  private block: BackendStartupBlock | null = null;
  private readonly decoders = {
    stdout: new StringDecoder("utf8"),
    stderr: new StringDecoder("utf8"),
  };

  push(chunk: unknown, source: "stdout" | "stderr" = "stdout"): void {
    const text = Buffer.isBuffer(chunk) ? this.decoders[source].write(chunk) : String(chunk);
    this.append(text);
  }

  end(source: "stdout" | "stderr"): void {
    this.append(this.decoders[source].end());
  }

  private append(text: string): void {
    if (text.length === 0 || this.block) return;
    this.output = `${this.output}${text.replace(/\r/g, "")}`.slice(-MAX_STARTUP_OUTPUT_CHARS);
    const lockErrorIndex = this.output.indexOf("DatabaseLifecycleLockedError:");
    if (lockErrorIndex === -1) return;
    const lockErrorOutput = this.output.slice(lockErrorIndex);
    const ownerPidMatch = lockErrorOutput.match(/owner pid (\d+) is live/);
    if (!ownerPidMatch && !lockErrorOutput.includes("\n")) return;
    const parsedOwnerPid = ownerPidMatch?.[1] ? Number.parseInt(ownerPidMatch[1], 10) : Number.NaN;
    this.block = {
      kind: "database-locked",
      ownerPid: Number.isSafeInteger(parsedOwnerPid) && parsedOwnerPid > 0 ? parsedOwnerPid : null,
    };
  }

  read(): BackendStartupBlock | null {
    return this.block;
  }
}
