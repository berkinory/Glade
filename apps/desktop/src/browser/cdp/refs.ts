import { BrowserFailure } from "../browserFailure";

export interface RefTarget {
  readonly backendNodeId: number;
  readonly sessionId: string | undefined;
}

const STALE =
  "is stale or unknown. Take a new browser_snapshot (or browser_find) and use its refs.";

// Refs are stable for one document: the same node keeps its ref across snapshots until the main
// frame commits a navigation or the debugger reattaches.
export class RefTable {
  private readonly byRef = new Map<string, RefTarget>();
  private readonly byKey = new Map<string, string>();
  private next = 1;

  refFor(target: RefTarget): string {
    const key = `${target.sessionId ?? ""}:${target.backendNodeId}`;
    const existing = this.byKey.get(key);
    if (existing) return existing;
    const ref = `e${this.next++}`;
    this.byKey.set(key, ref);
    this.byRef.set(ref, target);
    return ref;
  }

  resolve(ref: string): RefTarget {
    const target = this.byRef.get(ref);
    if (!target) throw new BrowserFailure("stale_ref", `Ref ${ref} ${STALE}`);
    return target;
  }

  invalidate(): void {
    this.byRef.clear();
    this.byKey.clear();
  }
}

// CDP reports a node that left the document as a generic protocol error; callers turn it into the
// typed stale-ref failure the model knows how to recover from.
export function rethrowStaleNode(ref: string) {
  return (error: unknown): never => {
    const message = error instanceof Error ? error.message : String(error);
    if (/No node|Could not find node|Node is detached|No target with given id/iu.test(message)) {
      throw new BrowserFailure("stale_ref", `Ref ${ref} ${STALE}`);
    }
    throw error;
  };
}
