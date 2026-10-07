import { echo } from "./combobox";

interface TypedField {
  readonly password: boolean;
  // -1 when the field has no maxlength.
  readonly maxLength: number;
  // Enters the text again at once and returns the new value; null when that is not safe.
  readonly refill: (() => Promise<string>) | null;
}

type Mismatch = "maxlength" | "lost_prefix" | "reordered" | "changed";

const sameLetters = (a: string, b: string) =>
  a.length === b.length && [...a].toSorted().join("") === [...b].toSorted().join("");

function classify(typed: string, actual: string, maxLength: number): Mismatch {
  if (maxLength >= 0 && maxLength < typed.length && actual === typed.slice(0, maxLength)) {
    return "maxlength";
  }
  if (actual.length > 0 && actual.length < typed.length && typed.endsWith(actual)) {
    return "lost_prefix";
  }
  return sameLetters(typed, actual) ? "reordered" : "changed";
}

const describe = (value: string, password: boolean) =>
  password ? `${value.length} characters` : echo(value);

// Compares what a field holds with what was typed. A field that lost the start of the text or
// shuffled it (a script resetting the caret mid-typing) is refilled once at once; a maxlength cut
// is the page's own limit and is only reported. Returns the note for the result, empty when the
// field holds the text.
export async function typedMismatch(
  typed: string,
  value: string,
  field: TypedField,
): Promise<string> {
  // A textarea or contenteditable may add a trailing newline of its own.
  const actual = value.endsWith("\n") && !typed.endsWith("\n") ? value.trimEnd() : value;
  if (actual === typed) return "";
  const kind = classify(typed, actual, field.maxLength);
  if (kind === "maxlength") {
    return ` The field takes at most ${field.maxLength} characters and kept ${describe(actual, field.password)}.`;
  }
  const what =
    kind === "lost_prefix"
      ? "lost the start of the text"
      : kind === "reordered"
        ? "got the characters out of order"
        : "";
  if (what && field.refill) {
    const again = await field.refill();
    if (again === typed)
      return ` The field ${what}, so Glade entered it again at once; it now holds the text.`;
    return ` The field ${what}, and entering it again at once left ${describe(again, field.password)}.`;
  }
  if (what) return ` The field ${what}: it holds ${describe(actual, field.password)}.`;
  return field.password
    ? ` The field holds ${actual.length} characters, not the ${typed.length} typed.`
    : ` The field now reads ${echo(actual)}.`;
}
