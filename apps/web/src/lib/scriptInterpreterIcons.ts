import { createBrandIcon } from "./createBrandIcon";
import type { IconComponent } from "./iconComponent";

// Marks from the bundled Symbols file icon set, drawn in the row's text color like other row icons.
const symbol = (name: string) => createBrandIcon(`/symbols/files/${name}.svg`, true);

const PythonIcon = symbol("python");
const RubyIcon = symbol("ruby");

export const SCRIPT_INTERPRETER_ICONS: Readonly<Record<string, IconComponent>> = {
  python: PythonIcon,
  python3: PythonIcon,
  node: symbol("node"),
  bun: symbol("bun"),
  deno: symbol("deno"),
  ruby: RubyIcon,
  perl: symbol("perl"),
  php: symbol("php"),
  sqlite3: symbol("database"),
};
