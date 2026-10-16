import { useState } from "react";
import { cn } from "~/lib/utils";
import { DisclosureChevron } from "./ui/DisclosureChevron";
import { PanelStateMessage } from "./chat/PanelStateMessage";
import {
  jsonContainerEntries,
  jsonContainerPreview,
  parseJsonDocument,
} from "./JsonFilePreview.logic";

type JsonEntry = readonly [string, unknown];

const CHILD_PAGE_SIZE = 200;
const AUTO_EXPAND_MAX_CHILDREN = 50;
const PLAIN_KEY_PATTERN = /^[\w$@.-]+$/;

function JsonScalar({ value }: { readonly value: unknown }) {
  if (typeof value === "string") {
    return (
      <span className="whitespace-pre-wrap break-all text-success">{JSON.stringify(value)}</span>
    );
  }
  if (typeof value === "number") return <span className="text-info">{value}</span>;
  return <span className="text-warning">{String(value)}</span>;
}

function JsonKey(props: {
  readonly name: string;
  readonly index: boolean;
  readonly separator?: boolean;
}) {
  return (
    <span className={cn("shrink-0", props.index ? "text-muted-foreground" : "text-foreground")}>
      {props.index || PLAIN_KEY_PATTERN.test(props.name) ? props.name : JSON.stringify(props.name)}
      {props.separator === false ? null : (
        <span className="whitespace-pre text-muted-foreground">: </span>
      )}
    </span>
  );
}

function ShowMoreButton(props: { readonly hidden: number; readonly onClick: () => void }) {
  if (props.hidden <= 0) return null;
  return (
    <button
      type="button"
      onClick={props.onClick}
      className="py-0.5 ps-5 text-muted-foreground hover:text-foreground"
    >
      Show {Math.min(CHILD_PAGE_SIZE, props.hidden).toLocaleString()} more of{" "}
      {props.hidden.toLocaleString()}
    </button>
  );
}

function JsonEntries(props: {
  readonly entries: readonly JsonEntry[];
  readonly indexed: boolean;
  readonly depth: number;
}) {
  const [limit, setLimit] = useState(CHILD_PAGE_SIZE);
  return (
    <>
      {props.entries.slice(0, limit).map(([name, value]) => (
        <JsonNode
          key={name}
          name={name}
          indexKey={props.indexed}
          value={value}
          depth={props.depth}
        />
      ))}
      <ShowMoreButton
        hidden={props.entries.length - limit}
        onClick={() => setLimit((current) => current + CHILD_PAGE_SIZE)}
      />
    </>
  );
}

function JsonNode(props: {
  readonly name: string;
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
      props.depth === 0 &&
      entries.length <= AUTO_EXPAND_MAX_CHILDREN,
  );
  if (entries === null) {
    // ps-5 matches the chevron width so scalar keys line up with container keys.
    return (
      <div className="flex py-0.5 ps-5">
        <JsonKey name={props.name} index={props.indexKey} />
        <span className="min-w-0">
          <JsonScalar value={props.value} />
        </span>
      </div>
    );
  }
  const isArray = Array.isArray(props.value);
  // An open container shows its entries, so only a collapsed one needs a summary.
  const summary = expanded ? null : jsonContainerPreview(props.value);
  return (
    <div>
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((current) => !current)}
        className="flex w-full items-center rounded-sm py-0.5 text-start hover:bg-foreground/5"
      >
        <DisclosureChevron open={expanded} className="me-1 size-4 shrink-0 text-muted-foreground" />
        <JsonKey name={props.name} index={props.indexKey} separator={summary !== null} />
        {summary ? <span className="min-w-0 truncate text-muted-foreground">{summary}</span> : null}
      </button>
      {expanded ? (
        // The guide line sits under the chevron's center.
        <div className="ms-2 border-s border-foreground/12 ps-2">
          <JsonEntries entries={entries} indexed={isArray} depth={props.depth + 1} />
        </div>
      ) : null}
    </div>
  );
}

function JsonRoot({ value }: { readonly value: unknown }) {
  const entries = jsonContainerEntries(value);
  if (entries === null) return <JsonScalar value={value} />;
  if (entries.length === 0) {
    return <span className="text-muted-foreground">{Array.isArray(value) ? "[]" : "{}"}</span>;
  }
  return <JsonEntries entries={entries} indexed={Array.isArray(value)} depth={0} />;
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
        <JsonRoot value={document.value} />
      ) : (
        <>
          {document.lines.slice(0, lineLimit).map((line) =>
            "error" in line ? (
              <div key={line.lineNumber} className="flex gap-2 py-0.5 ps-5">
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
          )}
          <ShowMoreButton
            hidden={document.lines.length - lineLimit}
            onClick={() => setLineLimit((current) => current + CHILD_PAGE_SIZE)}
          />
        </>
      )}
    </div>
  );
}
