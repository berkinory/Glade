import { useState } from "react";
import { cn } from "~/lib/utils";
import { DisclosureChevron } from "./ui/DisclosureChevron";
import { PanelStateMessage } from "./chat/PanelStateMessage";
import {
  jsonContainerEntries,
  jsonContainerPreview,
  parseJsonDocument,
} from "./JsonFilePreview.logic";

const CHILD_PAGE_SIZE = 200;
const INDENT_REM = 1.25;
const AUTO_EXPAND_MAX_CHILDREN = 50;

function containerSummary(value: unknown): string {
  if (Array.isArray(value)) return `[${value.length} ${value.length === 1 ? "item" : "items"}]`;
  const keys = Object.keys(value as object).length;
  return `{${keys} ${keys === 1 ? "key" : "keys"}}`;
}

function JsonScalar({ value }: { readonly value: unknown }) {
  if (typeof value === "string") {
    return (
      <span className="whitespace-pre-wrap break-all text-success">{JSON.stringify(value)}</span>
    );
  }
  if (typeof value === "number") return <span className="text-info">{value}</span>;
  return <span className="text-warning">{String(value)}</span>;
}

function JsonKey({ name, index }: { readonly name: string; readonly index: boolean }) {
  return (
    <span className={cn("shrink-0", index ? "text-muted-foreground" : "text-foreground")}>
      {index ? name : JSON.stringify(name)}
      <span className="whitespace-pre text-muted-foreground">: </span>
    </span>
  );
}

function ShowMoreButton(props: {
  readonly hidden: number;
  readonly depth: number;
  readonly onClick: () => void;
}) {
  if (props.hidden <= 0) return null;
  return (
    <button
      type="button"
      onClick={props.onClick}
      className="py-px text-muted-foreground hover:text-foreground"
      style={{ marginInlineStart: `${(props.depth + 1) * INDENT_REM}rem` }}
    >
      Show {Math.min(CHILD_PAGE_SIZE, props.hidden).toLocaleString()} more of{" "}
      {props.hidden.toLocaleString()}
    </button>
  );
}

function JsonNode(props: {
  readonly name: string | null;
  readonly indexKey: boolean;
  readonly value: unknown;
  readonly depth: number;
  readonly startCollapsed?: boolean;
}) {
  const entries = jsonContainerEntries(props.value);
  const [expanded, setExpanded] = useState(
    () =>
      entries !== null &&
      !props.startCollapsed &&
      props.depth < 2 &&
      entries.length <= AUTO_EXPAND_MAX_CHILDREN,
  );
  const [limit, setLimit] = useState(CHILD_PAGE_SIZE);
  const indent = { paddingInlineStart: `${props.depth * INDENT_REM}rem` };
  if (entries === null) {
    // Scalars sit under their parent's key, past the width of a disclosure chevron.
    return (
      <div
        className="flex py-px"
        style={{ paddingInlineStart: `${(props.depth + 1) * INDENT_REM}rem` }}
      >
        {props.name !== null ? <JsonKey name={props.name} index={props.indexKey} /> : null}
        <span className="min-w-0">
          <JsonScalar value={props.value} />
        </span>
      </div>
    );
  }
  const childrenAreIndexed = Array.isArray(props.value);
  return (
    <div>
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((current) => !current)}
        className="flex w-full items-center py-px text-start hover:bg-foreground/5"
        style={indent}
      >
        <DisclosureChevron open={expanded} className="me-1 size-4 shrink-0 text-muted-foreground" />
        {props.name !== null ? <JsonKey name={props.name} index={props.indexKey} /> : null}
        <span className="min-w-0 truncate text-muted-foreground">
          {expanded ? containerSummary(props.value) : jsonContainerPreview(props.value)}
        </span>
      </button>
      {expanded ? (
        <>
          {entries.slice(0, limit).map(([name, value]) => (
            <JsonNode
              key={name}
              name={name}
              indexKey={childrenAreIndexed}
              value={value}
              depth={props.depth + 1}
            />
          ))}
          <ShowMoreButton
            hidden={entries.length - limit}
            depth={props.depth + 1}
            onClick={() => setLimit((current) => current + CHILD_PAGE_SIZE)}
          />
        </>
      ) : null}
    </div>
  );
}

export function JsonFilePreview(props: {
  readonly contents: string;
  readonly lines: boolean;
  readonly truncated: boolean;
}) {
  const [lineLimit, setLineLimit] = useState(CHILD_PAGE_SIZE);
  const document = parseJsonDocument({
    text: props.contents,
    lines: props.lines,
    truncated: props.truncated,
  });
  if (document.kind === "error") {
    return (
      <PanelStateMessage density="compact" fill="flex">
        <p>{document.message}</p>
      </PanelStateMessage>
    );
  }
  return (
    <div className="min-h-0 flex-1 overflow-auto px-2 py-2 font-mono text-ui-sm">
      {document.kind === "value" ? (
        <JsonNode name={null} indexKey={false} value={document.value} depth={0} />
      ) : (
        document.lines.slice(0, lineLimit).map((line) =>
          "error" in line ? (
            <div key={line.lineNumber} className="flex gap-2 py-px ps-5">
              <span className="shrink-0 text-muted-foreground">{line.lineNumber}:</span>
              <span className="min-w-0 break-all text-destructive" title={line.error}>
                {line.text}
              </span>
            </div>
          ) : (
            <JsonNode
              key={line.lineNumber}
              name={String(line.lineNumber)}
              indexKey
              value={line.value}
              depth={0}
              startCollapsed
            />
          ),
        )
      )}
      {document.kind === "lines" ? (
        <ShowMoreButton
          hidden={document.lines.length - lineLimit}
          depth={0}
          onClick={() => setLineLimit((current) => current + CHILD_PAGE_SIZE)}
        />
      ) : null}
    </div>
  );
}
