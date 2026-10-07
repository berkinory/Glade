import { BrowserFailure } from "../browserFailure";

export interface RefTarget {
  readonly backendNodeId: number;
  readonly sessionId: string | undefined;
}

const STALE =
  "is stale or unknown. Take a new browser_snapshot (or browser_find) and use its refs.";

const MAX_LABEL_NAME = 60;

// Refs are stable for one document: the same node keeps its ref across snapshots until the main
// frame commits a navigation or the debugger reattaches.
export class RefTable {
  private readonly byRef = new Map<string, RefTarget>();
  private readonly byKey = new Map<string, string>();
  private readonly labels = new Map<string, string>();
  private next = 1;

  // `role` and `name` are the accessible role and name the ref was listed with, if known.
  refFor(target: RefTarget, accessible?: { readonly role: string; readonly name: string }): string {
    const key = `${target.sessionId ?? ""}:${target.backendNodeId}`;
    const ref = this.byKey.get(key) ?? `e${this.next++}`;
    if (!this.byRef.has(ref)) {
      this.byKey.set(key, ref);
      this.byRef.set(ref, target);
    }
    if (accessible?.role) {
      const name = accessible.name.trim();
      const shortName =
        name.length > MAX_LABEL_NAME ? `${name.slice(0, MAX_LABEL_NAME - 1)}…` : name;
      this.labels.set(
        ref,
        shortName ? `${accessible.role} ${JSON.stringify(shortName)}` : accessible.role,
      );
    }
    return ref;
  }

  // `button "Sign in" (e12)` when the ref was listed with a role, else the bare ref.
  describe(ref: string): string {
    const label = this.labels.get(ref);
    return label ? `${label} (${ref})` : ref;
  }

  resolve(ref: string): RefTarget {
    const target = this.byRef.get(ref);
    if (!target) throw new BrowserFailure("stale_ref", `Ref ${ref} ${STALE}`);
    return target;
  }

  invalidate(): void {
    this.byRef.clear();
    this.byKey.clear();
    this.labels.clear();
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
