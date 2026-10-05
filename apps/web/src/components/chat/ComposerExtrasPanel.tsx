import { CheckIcon, EnergyFilledIcon, AttachmentIcon } from "~/lib/icons";
import type { ThreadId } from "@glade/contracts/core/baseSchemas";
import { useEffect, useId, useRef, useState, type ChangeEvent } from "react";
import {
  COMPOSER_MENU_PANEL_GLYPH_CLASS_NAME,
  ComposerMenuPanel,
  type ComposerMenuPanelGroup,
} from "./ComposerMenuPanel";
export const COMPOSER_EXTRAS_TRIGGER_ATTRIBUTE = "data-composer-extras-trigger";
const GLYPH = COMPOSER_MENU_PANEL_GLYPH_CLASS_NAME;
const ROW_FILES = "extras:files";
const ROW_FAST = "extras:fast";
const CHECK = <CheckIcon className="size-3.5 text-foreground/70" />;
export function ComposerExtrasPanel(props: {
  supportsFastMode: boolean;
  fastModeEnabled: boolean;
  threadId?: ThreadId;
  onAddAttachments: (files: File[]) => void;
  onToggleFastMode: () => void;
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
          icon: <AttachmentIcon className={GLYPH} />,
          title: "Files and folders",
        },
        ...(props.supportsFastMode
          ? [
              {
                id: ROW_FAST,
                icon: <EnergyFilledIcon className={GLYPH} />,
                title: "Speed",
                secondary: props.fastModeEnabled ? "Fast" : "Default",
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
