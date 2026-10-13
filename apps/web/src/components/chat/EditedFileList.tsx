import { useVirtualizer } from "@tanstack/react-virtual";
import { useState, type ReactNode } from "react";
import { EDITED_FILE_ROW_HEIGHT_EM } from "./EditedFileRow";

// A turn can edit thousands of files. Rows have a fixed height and the list scrolls in its own
// capped box, so only the rows in view mount and the transcript never measures the list.
export function EditedFileList<T extends { readonly path: string }>(props: {
  files: ReadonlyArray<T>;
  fontSizePx: number;
  visibleRows: number;
  renderRow: (file: T, index: number) => ReactNode;
}) {
  const [viewport, setViewport] = useState<HTMLDivElement | null>(null);
  const rowHeightPx = EDITED_FILE_ROW_HEIGHT_EM * props.fontSizePx;
  const viewportHeightPx = props.visibleRows * rowHeightPx;
  const virtualizer = useVirtualizer({
    count: props.files.length,
    getScrollElement: () => viewport,
    getItemKey: (index) => props.files[index]!.path,
    estimateSize: () => rowHeightPx,
    overscan: 6,
    // Renders the first rows before the viewport is measured, so an opening list is never blank.
    initialRect: { width: 0, height: viewportHeightPx },
  });
  return (
    <div
      ref={setViewport}
      className="scroll-fade-y overflow-y-auto"
      style={{ fontSize: `${props.fontSizePx}px`, maxHeight: `${viewportHeightPx}px` }}
    >
      <div className="relative" style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((item) => (
          <div
            key={item.key}
            className="absolute top-0 left-0 w-full"
            style={{ transform: `translateY(${item.start}px)` }}
          >
            {props.renderRow(props.files[item.index]!, item.index)}
          </div>
        ))}
      </div>
    </div>
  );
}
