import { lowerCaseExtensionOf } from "@glade/shared/attachments/localPreviewFiles";
import { DataTable } from "./DataTable";
import { detectCsvDelimiter, parseCsvTable } from "./CsvFilePreview.logic";
import { PanelStateMessage } from "./chat/PanelStateMessage";

const CSV_ROW_LIMIT = 1000;

export function CsvFilePreview(props: {
  readonly filePath: string;
  readonly contents: string;
  readonly truncated: boolean;
}) {
  const delimiter =
    lowerCaseExtensionOf(props.filePath) === ".tsv" ? "\t" : detectCsvDelimiter(props.contents);
  const table = parseCsvTable({
    text: props.contents,
    delimiter,
    truncated: props.truncated,
  });
  if (table.columns.length === 0) {
    return (
      <PanelStateMessage density="compact" fill="flex">
        <p>This file is empty.</p>
      </PanelStateMessage>
    );
  }
  return (
    <DataTable
      columns={table.columns}
      rows={table.rows}
      text="ui"
      rowLimit={CSV_ROW_LIMIT}
      className="min-h-0 flex-1"
    />
  );
}
