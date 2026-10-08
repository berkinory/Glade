interface ThreadRange {
  /** Highest sequence of this thread already settled. */
  after: number;
  /** Highest admitted intent of this thread. */
  through: number;
  readonly laneKey: string;
}

export interface UnsettledRange {
  readonly threadId: string;
  readonly after: number;
  readonly through: number;
}

/**
 * Delivery state for provider intents grouped by native session owner. Lanes hold sequence ranges
 * per thread, never event payloads, so a stalled owner costs one range however many intents queue
 * behind it. The acknowledgement fence is the lowest unsettled position across all lanes.
 */
export class ProviderDeliveryLanes {
  private readonly ranges = new Map<string, ThreadRange>();
  private readonly runningLanes = new Set<string>();
  private admitted: number;

  constructor(acknowledgedThrough: number) {
    this.admitted = acknowledgedThrough;
  }

  get admittedThrough(): number {
    return this.admitted;
  }

  /** A thread with unsettled work stays on its lane even if its owner would now resolve elsewhere. */
  laneFor(threadId: string): string | undefined {
    return this.ranges.get(threadId)?.laneKey;
  }

  /** Records an intent and returns true when its lane has no running reader yet. */
  admitIntent(threadId: string, laneKey: string, sequence: number): boolean {
    const range = this.ranges.get(threadId);
    if (range) range.through = Math.max(range.through, sequence);
    else this.ranges.set(threadId, { after: sequence - 1, through: sequence, laneKey });
    this.admitted = Math.max(this.admitted, sequence);
    const key = range?.laneKey ?? laneKey;
    if (this.runningLanes.has(key)) return false;
    this.runningLanes.add(key);
    return true;
  }

  admitSettled(sequence: number): void {
    this.admitted = Math.max(this.admitted, sequence);
  }

  unsettledRanges(laneKey: string): ReadonlyArray<UnsettledRange> {
    const result: UnsettledRange[] = [];
    for (const [threadId, range] of this.ranges) {
      if (range.laneKey === laneKey && range.through > range.after) {
        result.push({ threadId, after: range.after, through: range.through });
      }
    }
    return result;
  }

  settle(threadId: string, through: number): void {
    const range = this.ranges.get(threadId);
    if (!range) return;
    range.after = Math.max(range.after, through);
    if (range.after >= range.through) this.ranges.delete(threadId);
  }

  /** Stops the lane reader when nothing is left; a later admission starts a new one. */
  releaseLaneIfIdle(laneKey: string): boolean {
    if (this.unsettledRanges(laneKey).length > 0) return false;
    this.runningLanes.delete(laneKey);
    return true;
  }

  /** Every event at or below this sequence is settled, so the durable cursor may move here. */
  settledPrefix(): number {
    let through = this.admitted;
    for (const range of this.ranges.values()) through = Math.min(through, range.after);
    return through;
  }

  processedThrough(threadId: string): number {
    return this.ranges.get(threadId)?.after ?? this.admitted;
  }
}
