/**
 * Admission order per aggregate. Work for one aggregate runs strictly in admission order, even when
 * a later item was taken first from a higher-priority lane; different aggregates never wait on each
 * other here.
 */
export class AggregateCommandOrder<A> {
  private readonly admitted = new Map<string, A[]>();
  private readonly taken = new Set<A>();

  admit(key: string, item: A): void {
    const items = this.admitted.get(key);
    if (items) items.push(item);
    else this.admitted.set(key, [item]);
  }

  /** Returns true when the item may run now; otherwise it starts from `finish` of its predecessor. */
  take(key: string, item: A): boolean {
    if (this.admitted.get(key)?.[0] === item) return true;
    this.taken.add(item);
    return false;
  }

  /** Retires the running head and returns the next item when it is already waiting to run. */
  finish(key: string, item: A): A | undefined {
    const items = this.admitted.get(key);
    if (!items || items[0] !== item) return undefined;
    items.shift();
    if (items.length === 0) {
      this.admitted.delete(key);
      return undefined;
    }
    const next = items[0]!;
    return this.taken.delete(next) ? next : undefined;
  }
}
