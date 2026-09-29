import { createContentSearchPattern, type ContentSearchOptions } from "@glade/shared/searchQuery";

export function ContentSearchMatchText(
  props: { text: string; query: string } & ContentSearchOptions,
) {
  if (!props.query.trim()) return <>{props.text}</>;
  const pattern = createContentSearchPattern(props.query.trim(), props);
  const parts = [];
  let cursor = 0;
  for (const match of props.text.matchAll(pattern)) {
    const start = match.index;
    parts.push(props.text.slice(cursor, start));
    parts.push(
      <mark className="rounded-[2px] bg-primary/20 text-foreground" key={start}>
        {match[0]}
      </mark>,
    );
    cursor = start + match[0].length;
  }
  parts.push(props.text.slice(cursor));
  return <>{parts}</>;
}
