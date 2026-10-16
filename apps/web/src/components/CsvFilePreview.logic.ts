export interface CsvTable {
  readonly columns: readonly string[];
  readonly rows: readonly (readonly string[])[];
}

const CANDIDATE_DELIMITERS = [",", ";", "\t", "|"] as const;

// Spreadsheet exports in many locales use semicolons, so the delimiter is the candidate that occurs
// most often outside quotes on the first line.
export function detectCsvDelimiter(text: string): string {
  const counts = new Map<string, number>();
  let quoted = false;
  for (const char of text) {
    if (char === '"') quoted = !quoted;
    else if (!quoted && char === "\n") break;
    else if (!quoted) counts.set(char, (counts.get(char) ?? 0) + 1);
  }
  let best: string = ",";
  for (const candidate of CANDIDATE_DELIMITERS) {
    if ((counts.get(candidate) ?? 0) > (counts.get(best) ?? 0)) best = candidate;
  }
  return best;
}

// RFC 4180 records: quoted fields may contain delimiters, newlines and doubled quotes. The server
// already normalizes line endings to \n.
function parseCsvRecords(text: string, delimiter: string): string[][] {
  const records: string[][] = [];
  let record: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!;
    if (quoted) {
      if (char !== '"') field += char;
      else if (text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else quoted = false;
    } else if (char === '"' && field === "") quoted = true;
    else if (char === delimiter) {
      record.push(field);
      field = "";
    } else if (char === "\n") {
      record.push(field);
      records.push(record);
      record = [];
      field = "";
    } else field += char;
  }
  if (field !== "" || record.length > 0) {
    record.push(field);
    records.push(record);
  }
  return records;
}

export function parseCsvTable(input: {
  readonly text: string;
  readonly delimiter: string;
  readonly truncated: boolean;
}): CsvTable {
  const records = parseCsvRecords(input.text, input.delimiter);
  // A truncated read usually cuts the last record in half.
  if (input.truncated) records.pop();
  const [header = [], ...rows] = records;
  const width = rows.reduce((max, row) => Math.max(max, row.length), header.length);
  const columns = Array.from(
    { length: width },
    (_, index) => header[index]?.trim() || `Column ${index + 1}`,
  );
  return { columns, rows };
}
