export interface ThreadDetailSyncEvidence {
  readonly appliedEventSerial: number;

  readonly emptyReplayAtEventSerial: number | null;
}

export function isThreadDetailVerifiedInSync(evidence: ThreadDetailSyncEvidence): boolean {
  return (
    evidence.emptyReplayAtEventSerial !== null &&
    evidence.emptyReplayAtEventSerial === evidence.appliedEventSerial
  );
}
