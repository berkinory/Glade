export interface StreamedToolInput {
  readonly json: string;
  readonly depth: number;
  readonly inString: boolean;
  readonly escaped: boolean;
}

export interface ParsedToolInput {
  readonly value: Record<string, unknown>;
  readonly serialized: string;
}

export const emptyStreamedToolInput: StreamedToolInput = {
  json: "",
  depth: 0,
  inString: false,
  escaped: false,
};

// Large Write and Edit inputs arrive in thousands of small deltas. Scanning only the new chunk for
// the top-level close keeps the work linear; parsing or trimming the accumulated text on every
// delta made it quadratic.
export function appendStreamedToolInput(
  input: StreamedToolInput,
  chunk: string,
): { readonly input: StreamedToolInput; readonly parsed: ParsedToolInput | undefined } {
  let { depth, inString, escaped } = input;
  let closed = false;
  for (let index = 0; index < chunk.length; index += 1) {
    const char = chunk.charCodeAt(index);
    if (inString) {
      if (escaped) escaped = false;
      else if (char === 0x5c) escaped = true;
      else if (char === 0x22) inString = false;
    } else if (char === 0x22) inString = true;
    else if (char === 0x7b || char === 0x5b) depth += 1;
    else if (char === 0x7d || char === 0x5d) {
      depth -= 1;
      if (depth === 0) closed = true;
    }
  }
  const json = input.json + chunk;
  return {
    input: { json, depth, inString, escaped },
    parsed: closed && depth === 0 ? parseJsonRecord(json) : undefined,
  };
}

function parseJsonRecord(json: string): ParsedToolInput | undefined {
  try {
    const parsed: unknown = JSON.parse(json);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
    return { value: parsed as Record<string, unknown>, serialized: JSON.stringify(parsed) };
  } catch {
    return undefined;
  }
}
