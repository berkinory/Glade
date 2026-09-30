import type { FileContents as PierreFileContents } from "@pierre/diffs";
import {
  Editor as PierreEditor,
  type EditorOptions as PierreEditorOptions,
} from "@pierre/diffs/edit";
import { EditProvider, File as PierreFile } from "@pierre/diffs/react";
import {
  Component,
  Suspense,
  type ReactNode,
  use,
  useCallback,
  useEffect,
  useId,
  useInsertionEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useAppSettings } from "~/appSettings";
import type { DiffThemeName } from "~/lib/diffRendering";
import type { EditorGutterChangeRange } from "~/lib/editorGutterDiff";
import {
  MAX_SYNTAX_HIGHLIGHT_INPUT_CHARS,
  cacheSyntaxHighlightedHtml,
  createSyntaxHighlightCacheKey,
  getCachedSyntaxHighlightedHtml,
  getSyntaxHighlighterPromise,
  getSyntaxLanguageForPath,
  highlightCodeToHtmlWithFallback,
} from "~/lib/syntaxHighlighting";
import { cn } from "~/lib/utils";
import { buildCodeEditorUnsafeCSS } from "./codeEditor/codeEditorAppearance";
import { CODE_EDITOR_KEYMAP } from "./codeEditor/pierreEdit";
import { Skeleton } from "./ui/skeleton";

class FilePreviewHighlightErrorBoundary extends Component<
  { fallback: ReactNode; children: ReactNode },
  { hasError: boolean }
> {
  constructor(props: { fallback: ReactNode; children: ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  override render() {
    if (this.state.hasError) {
      return this.props.fallback;
    }
    return this.props.children;
  }
}

const MAX_PLAIN_NUMBERED_LINES = 20_000;

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function PlainFileContents(props: { contents: string }) {
  const lines = props.contents.split("\n");
  const numberedHtml =
    props.contents.length === 0 || lines.length > MAX_PLAIN_NUMBERED_LINES
      ? null
      : `<code>${lines
          .map((line, index) =>
            index === lines.length - 1
              ? `<span class="line">${escapeHtml(line)}</span>`
              : `<span class="line">${escapeHtml(line)}\n</span>`,
          )
          .join("")}</code>`;

  if (numberedHtml !== null) {
    return (
      <pre
        className="editor-file-viewer__plain"
        aria-readonly="true"
        dangerouslySetInnerHTML={{ __html: numberedHtml }}
      />
    );
  }

  return (
    <pre className="editor-file-viewer__plain" aria-readonly="true">
      {props.contents}
    </pre>
  );
}

function SyntaxHighlightedFileContents(props: {
  path: string;
  contents: string;
  themeName: DiffThemeName;
}) {
  const language = getSyntaxLanguageForPath(props.path);
  const cacheKey = createSyntaxHighlightCacheKey(props.contents, language, props.themeName);
  const cachedHighlightedHtml = getCachedSyntaxHighlightedHtml(cacheKey);

  if (cachedHighlightedHtml != null) {
    return (
      <div
        className="editor-file-viewer__highlight"
        data-syntax-highlighted="true"
        dangerouslySetInnerHTML={{ __html: cachedHighlightedHtml }}
      />
    );
  }

  // The uncached path lives in its own component: an early return above must not change this
  // component's hook order once the cache fills.
  return (
    <UncachedSyntaxHighlightedFileContents
      cacheKey={cacheKey}
      contents={props.contents}
      language={language}
      themeName={props.themeName}
    />
  );
}

function UncachedSyntaxHighlightedFileContents(props: {
  cacheKey: string;
  contents: string;
  language: string;
  themeName: DiffThemeName;
}) {
  const highlighter = use(getSyntaxHighlighterPromise(props.language));
  const highlightedHtml = highlightCodeToHtmlWithFallback(
    highlighter,
    props.contents,
    props.language,
    props.themeName,
  );

  useEffect(() => {
    cacheSyntaxHighlightedHtml(props.cacheKey, highlightedHtml, props.contents);
  }, [props.cacheKey, highlightedHtml, props.contents]);

  return (
    <div
      className="editor-file-viewer__highlight"
      data-syntax-highlighted="true"
      dangerouslySetInnerHTML={{ __html: highlightedHtml }}
    />
  );
}

// The highlighted body (and its cache lookup) is skipped across selection and diff-warming
// re-renders because its inputs (path, contents, themeName) are stable unless the file changes —
// the React Compiler handles the memoization.
export function FileContentsView(props: {
  path: string;
  contents: string;
  themeName: DiffThemeName;
}) {
  const plain = <PlainFileContents contents={props.contents} />;
  if (props.contents.length === 0 || props.contents.length > MAX_SYNTAX_HIGHLIGHT_INPUT_CHARS) {
    return plain;
  }

  return (
    <FilePreviewHighlightErrorBoundary key={props.path} fallback={plain}>
      <Suspense fallback={plain}>
        <SyntaxHighlightedFileContents
          path={props.path}
          contents={props.contents}
          themeName={props.themeName}
        />
      </Suspense>
    </FilePreviewHighlightErrorBoundary>
  );
}

function createPierreEditor(options: PierreEditorOptions<undefined>) {
  return new PierreEditor(options);
}

type EditableFileContentsProps = {
  revealPosition?: { lineNumber: number; requestId: number } | undefined;
  path: string;
  contents: string;
  cacheKey: string;
  hidden: boolean;
  themeName: DiffThemeName;
  theme: "light" | "dark";
  saving: boolean;
  invalid: boolean;
  onContentsChange: (contents: string) => void;
  onSave: () => void;
};

export function EditableFileContents(props: EditableFileContentsProps) {
  const { settings } = useAppSettings();
  const pierreRef = useRef<PierreEditor<undefined> | null>(null);
  const revealRef = useRef(props.revealPosition);
  revealRef.current = props.revealPosition;
  useEffect(() => {
    if (props.revealPosition && !props.hidden)
      pierreRef.current?.focus({ lineNumber: props.revealPosition.lineNumber });
  }, [props.revealPosition, props.hidden]);
  const editorContainerRef = useRef<HTMLDivElement>(null);
  const editorId = useId();
  const labelEditor = useCallback(() => {
    editorContainerRef.current
      ?.querySelector("diffs-container")
      ?.shadowRoot?.querySelector<HTMLElement>('[contenteditable="true"]')
      ?.setAttribute("aria-label", `Edit ${props.path}`);
  }, [props.path]);
  const editorObserverRef = useRef<MutationObserver | null>(null);
  const attachEditor = useCallback(() => {
    const shadowRoot = editorContainerRef.current?.querySelector("diffs-container")?.shadowRoot;
    if (!shadowRoot) return;
    labelEditor();
    if (editorObserverRef.current === null) {
      editorObserverRef.current = new MutationObserver(labelEditor);
    }
    editorObserverRef.current.observe(shadowRoot, { childList: true, subtree: true });
  }, [labelEditor]);
  useEffect(() => {
    attachEditor();
    return () => {
      editorObserverRef.current?.disconnect();
      editorObserverRef.current = null;
    };
  }, [attachEditor]);

  const [document, setDocument] = useState({
    contents: props.contents,
    seedContents: props.contents,
    revision: 0,
  });
  if (document.contents !== props.contents) {
    setDocument({
      contents: props.contents,
      seedContents: props.contents,
      revision: document.revision + 1,
    });
  }
  const onContentsChangeRef = useRef(props.onContentsChange);
  useInsertionEffect(() => {
    onContentsChangeRef.current = props.onContentsChange;
  });
  const file = useMemo<PierreFileContents>(
    () => ({
      name: props.path,
      contents: document.seedContents,
      lang: getSyntaxLanguageForPath(props.path),
      cacheKey: `${props.cacheKey}:${editorId}:${document.revision}`,
    }),
    [document.seedContents, document.revision, editorId, props.cacheKey, props.path],
  );
  const editorOptions = useMemo<PierreEditorOptions<undefined>>(
    () => ({
      keymap: CODE_EDITOR_KEYMAP,
      onAttach: (editor) => {
        pierreRef.current = editor;
        attachEditor();
        if (revealRef.current) editor.focus({ lineNumber: revealRef.current.lineNumber });
      },
      onChange: (nextFile) => {
        const contents = nextFile.contents;
        setDocument((current) => ({ ...current, contents }));
        onContentsChangeRef.current(contents);
      },
    }),
    [attachEditor],
  );

  return (
    <div
      ref={editorContainerRef}
      data-workspace-file-editor
      data-editor-caret-style={settings.editorCaretStyle}
      className="code-editor-pane editor-file-editor__pierre"
      hidden={props.hidden}
      aria-busy={props.saving}
      aria-invalid={props.invalid ? "true" : undefined}
      onKeyDown={(event) => {
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
          event.preventDefault();
          props.onSave();
        }
      }}
    >
      <EditProvider createEditor={createPierreEditor}>
        <PierreFile
          file={file}
          edit
          editorOptions={editorOptions}
          options={{
            disableFileHeader: true,
            overflow: "scroll",
            preferredHighlighter: "shiki-js",
            theme: props.themeName,
            unsafeCSS: buildCodeEditorUnsafeCSS(props.theme),
          }}
        />
      </EditProvider>
    </div>
  );
}

function filePreviewRowOffset(rows: number): string {
  return `calc(var(--editor-file-padding, 1rem) + ${rows} * var(--editor-file-line-height, 1.65) * 1em)`;
}

function filePreviewRowSpan(rows: number): string {
  return `calc(${rows} * var(--editor-file-line-height, 1.65) * 1em)`;
}

export function FilePreviewChangeGutter(props: {
  ranges: readonly EditorGutterChangeRange[];
  subtle: boolean;
}) {
  return (
    <div
      className="editor-file-viewer__change-gutter"
      data-subtle={props.subtle ? "true" : undefined}
      aria-hidden="true"
    >
      {props.ranges.map((range) =>
        range.kind === "deleted" ? (
          <span
            key={`deleted-${range.startLine}`}
            className="editor-file-viewer__change-notch"
            style={{ top: filePreviewRowOffset(range.startLine) }}
          />
        ) : (
          <span
            key={`${range.kind}-${range.startLine}-${range.endLine}`}
            className="editor-file-viewer__change-bar"
            data-change={range.kind}
            style={{
              top: filePreviewRowOffset(range.startLine - 1),
              height: filePreviewRowSpan(range.endLine - range.startLine + 1),
            }}
          />
        ),
      )}
    </div>
  );
}

const FILE_PREVIEW_SKELETON_LINES = [
  { indent: 0, width: "w-5/12" },
  { indent: 0, width: "w-8/12" },
  { indent: 1, width: "w-10/12" },
  { indent: 1, width: "w-7/12" },
  { indent: 2, width: "w-9/12" },
  { indent: 2, width: "w-4/12" },
  { indent: 1, width: "w-6/12" },
  { indent: 0, width: "w-3/12" },
  { indent: 0, width: "w-7/12" },
  { indent: 1, width: "w-9/12" },
  { indent: 1, width: "w-5/12" },
  { indent: 0, width: "w-2/12" },
];

export function FilePreviewLoadingState() {
  return (
    <div
      className="min-h-0 flex-1 space-y-2.5 overflow-hidden px-3 py-3"
      role="status"
      aria-label="Loading file..."
    >
      {FILE_PREVIEW_SKELETON_LINES.map((line) => (
        <div key={`${line.indent}-${line.width}`} className="flex h-3 items-center gap-2">
          <Skeleton className="h-2.5 w-5 shrink-0 rounded-full opacity-60" />
          <Skeleton
            className={cn("h-2.5 rounded-full", line.width)}
            style={{ marginLeft: `${line.indent * 1}rem` }}
          />
        </div>
      ))}
      <span className="sr-only">Loading file...</span>
    </div>
  );
}
