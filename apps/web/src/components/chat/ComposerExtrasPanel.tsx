import type { ProviderInteractionMode } from "@glade/contracts/provider/sessionPolicy";
import type { ThreadId } from "@glade/contracts/core/baseSchemas";
import { useEffect, useId, useRef, useState, type ChangeEvent } from "react";

import {
  BugIcon,
  CheckIcon,
  FastModeIcon,
  GoalIcon,
  ListTodoIcon,
  PaperclipIcon,
} from "~/lib/icons";

import {
  COMPOSER_MENU_PANEL_GLYPH_CLASS_NAME,
  ComposerMenuPanel,
  type ComposerMenuPanelGroup,
} from "./ComposerMenuPanel";

export const COMPOSER_EXTRAS_TRIGGER_ATTRIBUTE = "data-composer-extras-trigger";

const GLYPH = COMPOSER_MENU_PANEL_GLYPH_CLASS_NAME;

const ROW_FILES = "extras:files";
const ROW_GOAL = "extras:goal";
const ROW_PLAN = "extras:mode:plan";
const ROW_DEBUG = "extras:mode:debug";
const ROW_FAST = "extras:fast";

const CHECK = <CheckIcon className="size-3.5 text-foreground/70" />;

function toggleSecondary(label: string, enabled: boolean): string {
  return `Turn ${label} ${enabled ? "off" : "on"}`;
}

export function ComposerExtrasPanel(props: {
  interactionMode: ProviderInteractionMode;
  supportsFastMode: boolean;
  fastModeEnabled: boolean;
  threadId?: ThreadId;
  onAddAttachments: (files: File[]) => void;
  onToggleFastMode: () => void;
  onInteractionModeChange: (mode: ProviderInteractionMode) => void;

  onInsertGoal: () => void;
  onClose: () => void;
  panelId: string;
}) {
  const inputId = useId();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [activeRowId, setActiveRowId] = useState<string | null>(ROW_FILES);

  const groups: ComposerMenuPanelGroup[] = [
    {
      id: "add",
      label: "Add",
      rows: [
        {
          id: ROW_FILES,
          icon: <PaperclipIcon className={GLYPH} />,
          title: "Files and folders",
        },
        {
          id: ROW_GOAL,
          icon: <GoalIcon className={GLYPH} />,
          title: "Goal",
          secondary: "Set a goal to keep pursuing",
        },
        {
          id: ROW_PLAN,
          icon: <ListTodoIcon className={GLYPH} />,
          title: "Plan mode",
          secondary: toggleSecondary("plan mode", props.interactionMode === "plan"),
          trailing: props.interactionMode === "plan" ? CHECK : null,
        },
        {
          id: ROW_DEBUG,
          icon: <BugIcon className={GLYPH} />,
          title: "Debug mode",
          secondary: toggleSecondary("debug mode", props.interactionMode === "debug"),
          trailing: props.interactionMode === "debug" ? CHECK : null,
        },
        ...(props.supportsFastMode
          ? [
              {
                id: ROW_FAST,
                icon: <FastModeIcon className={GLYPH} />,
                title: "Fast mode",
                secondary: toggleSecondary("fast mode", props.fastModeEnabled),
                trailing: props.fastModeEnabled ? CHECK : null,
              },
            ]
          : []),
      ],
    },
  ];

  const selectableRowIds = groups.flatMap((group) =>
    group.rows.filter((row) => !row.disabled).map((row) => row.id),
  );

  const highlightedRowId =
    activeRowId && selectableRowIds.includes(activeRowId)
      ? activeRowId
      : (selectableRowIds[0] ?? null);

  const selectRow = (rowId: string) => {
    if (rowId === ROW_FILES) {
      fileInputRef.current?.click();
      return;
    }
    if (rowId === ROW_GOAL) {
      props.onInsertGoal();
      props.onClose();
      return;
    }
    if (rowId === ROW_PLAN || rowId === ROW_DEBUG) {
      const mode: ProviderInteractionMode = rowId === ROW_PLAN ? "plan" : "debug";
      props.onInteractionModeChange(props.interactionMode === mode ? "default" : mode);
      props.onClose();
      return;
    }
    if (rowId === ROW_FAST) {
      props.onToggleFastMode();
      props.onClose();
      return;
    }
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;

      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        {
          props.onClose();
        }
        return;
      }

      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        if (selectableRowIds.length === 0) return;
        event.preventDefault();
        event.stopPropagation();
        const currentIndex = highlightedRowId ? selectableRowIds.indexOf(highlightedRowId) : -1;
        const offset = event.key === "ArrowDown" ? 1 : -1;
        const nextIndex =
          (currentIndex + offset + selectableRowIds.length) % selectableRowIds.length;
        setActiveRowId(selectableRowIds[nextIndex] ?? null);
        return;
      }

      if (event.key === "Enter" || event.key === "Tab") {
        if (!highlightedRowId) return;
        event.preventDefault();
        event.stopPropagation();
        selectRow(highlightedRowId);
      }
    };

    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
    };
  });

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (containerRef.current?.contains(target)) return;
      if (
        target instanceof Element &&
        target.closest(`[${COMPOSER_EXTRAS_TRIGGER_ATTRIBUTE}]`) !== null
      ) {
        return;
      }
      props.onClose();
    };

    window.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
    };
  });

  const handleFileInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    if (files.length > 0) {
      props.onAddAttachments(files);
    }
    event.target.value = "";
    props.onClose();
  };

  return (
    <div ref={containerRef} id={props.panelId} data-testid="composer-extras-panel">
      <input
        id={inputId}
        ref={fileInputRef}
        data-testid="composer-file-input"
        type="file"
        multiple
        className="sr-only"
        onChange={handleFileInputChange}
      />
      <ComposerMenuPanel
        groups={groups}
        activeRowId={highlightedRowId}
        onHighlightRow={setActiveRowId}
        onSelectRow={selectRow}
      />
    </div>
  );
}
