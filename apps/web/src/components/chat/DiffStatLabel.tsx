export function DiffStatLabel(props: { additions: number; deletions: number }) {
  const { additions, deletions } = props;
  return (
    <span className="inline-flex items-baseline gap-1.5 tabular-nums">
      <span className="text-[var(--color-decoration-added)]">+{additions}</span>
      <span className="text-[var(--color-decoration-deleted)]">-{deletions}</span>
    </span>
  );
}
