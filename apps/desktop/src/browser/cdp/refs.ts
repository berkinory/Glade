import { BrowserFailure } from "../browserFailure";

// A node is identified by the CDP session that renders it and its backend id, which is unique
// within that renderer. `frameId` is the frame document it belongs to; undefined means the main
// frame.
export interface RefTarget {
  readonly backendNodeId: number;
  readonly sessionId: string | undefined;
  readonly frameId?: string | undefined;
}

const STALE =
  "is stale or unknown. Take a new browser_snapshot (or browser_find) and use its refs.";

const MAX_LABEL_NAME = 60;
// The last two cover an out-of-process frame whose target or session is already gone.
const STALE_NODE_ERROR =
  /No node|Could not find node|Node is detached|No target with given id|Session with given id not found/iu;

const refNumber = (ref: string) => Number(ref.slice(1));

// A ref lives as long as its node's document: DOM updates within the document keep it, and a new
// document in its frame (or a lost debugger) drops it. Numbers only grow, so a dropped ref never
// comes back pointing at another element.
export class RefTable {
  private readonly byRef = new Map<string, RefTarget>();
  private readonly byKey = new Map<string, string>();
  private readonly labels = new Map<string, string>();
  private next = 1;
  // Refs numbered at or above this were first listed after the previous snapshot; null until a
  // snapshot of the current main document was taken.
  private newSince: number | null = null;

  // `role` and `name` are the accessible role and name the ref was listed with, if known.
  refFor(target: RefTarget, accessible?: { readonly role: string; readonly name: string }): string {
    const key = `${target.sessionId ?? ""}:${target.backendNodeId}`;
    const ref = this.byKey.get(key) ?? `e${this.next++}`;
    if (!this.byRef.has(ref)) {
      this.byKey.set(key, ref);
      this.byRef.set(ref, target);
    }
    if (accessible?.role) {
      const name = accessible.name.replace(/\s+/gu, " ").trim();
      const shortName =
        name.length > MAX_LABEL_NAME ? `${name.slice(0, MAX_LABEL_NAME - 1)}…` : name;
      this.labels.set(
        ref,
        shortName ? `${accessible.role} ${JSON.stringify(shortName)}` : accessible.role,
      );
    }
    return ref;
  }

  isNew(ref: string): boolean {
    return this.newSince !== null && refNumber(ref) >= this.newSince;
  }

  // Called after a full snapshot was rendered: later refs count as new in the next one.
  markSnapshot(): void {
    this.newSince = this.next;
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

  // An out-of-process frame that went away takes its nodes with its session.
  dropSession(sessionId: string): void {
    this.drop((target) => target.sessionId === sessionId);
  }

  // A frame committed a new document (or was removed): its old nodes are gone.
  dropFrame(frameId: string): void {
    this.drop((target) => target.frameId === frameId);
  }

  invalidate(): void {
    this.byRef.clear();
    this.byKey.clear();
    this.labels.clear();
    this.newSince = null;
  }

  private drop(matches: (target: RefTarget) => boolean): void {
    for (const [ref, target] of this.byRef) {
      if (!matches(target)) continue;
      this.byRef.delete(ref);
      this.byKey.delete(`${target.sessionId ?? ""}:${target.backendNodeId}`);
      this.labels.delete(ref);
    }
  }
}

// CDP reports a node that left the document as a generic protocol error; callers turn it into the
// typed stale-ref failure the model knows how to recover from.
export function rethrowStaleNode(ref: string) {
  return (error: unknown): never => {
    const message = error instanceof Error ? error.message : String(error);
    if (STALE_NODE_ERROR.test(message)) {
      throw new BrowserFailure("stale_ref", `Ref ${ref} ${STALE}`);
    }
    throw error;
  };
}
