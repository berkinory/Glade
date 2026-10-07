// Scores browser_find candidates against a query. A query that appears verbatim in some element
// matches as an exact substring; otherwise it is read as natural language ("search field", "add
// to cart button"): role words pick roles, the other words must appear in the element's name,
// value, description or text (half of them for longer queries), and with no such element the
// role alone decides.

export interface FindCandidate {
  // For text, the role of the element the text belongs to.
  readonly role: string;
  readonly name: string;
  readonly value: string | undefined;
  readonly description: string | undefined;
  readonly interactive: boolean;
  // Text of the table row, list item or article it sits in: "refund button for order A-1043".
  readonly context: string | undefined;
}

const ROLE_WORDS: Readonly<Record<string, readonly string[]>> = {
  button: ["button", "clickable"],
  btn: ["button", "clickable"],
  link: ["link"],
  hyperlink: ["link"],
  anchor: ["link"],
  field: ["textbox", "searchbox", "combobox", "spinbutton", "Date", "DateTime", "InputTime"],
  input: ["textbox", "searchbox", "combobox", "spinbutton", "Date", "DateTime", "InputTime"],
  textbox: ["textbox", "searchbox"],
  textfield: ["textbox", "searchbox"],
  textarea: ["textbox"],
  searchbox: ["searchbox", "textbox"],
  box: ["textbox", "searchbox", "combobox", "checkbox"],
  checkbox: ["checkbox", "switch", "menuitemcheckbox"],
  check: ["checkbox", "switch", "menuitemcheckbox"],
  toggle: ["switch", "checkbox", "button"],
  switch: ["switch", "checkbox"],
  radio: ["radio", "menuitemradio"],
  dropdown: ["combobox", "listbox"],
  select: ["combobox", "listbox"],
  combobox: ["combobox"],
  combo: ["combobox"],
  picker: ["combobox", "listbox", "Date", "DateTime", "InputTime", "ColorWell"],
  listbox: ["listbox"],
  option: ["option"],
  tab: ["tab"],
  menu: ["menu", "menubar", "menuitem"],
  menuitem: ["menuitem", "menuitemcheckbox", "menuitemradio"],
  item: ["menuitem", "option", "listitem", "treeitem"],
  slider: ["slider"],
  heading: ["heading"],
  image: ["image", "img"],
  img: ["image", "img"],
  icon: ["image", "img", "button"],
  row: ["row"],
  cell: ["cell", "gridcell"],
  dialog: ["dialog", "alertdialog"],
  modal: ["dialog", "alertdialog"],
};

// Two words that name one role: "menu item", "text box".
const PAIRED_ROLE_WORDS = new Set([
  "menuitem",
  "textbox",
  "textfield",
  "checkbox",
  "combobox",
  "listbox",
]);

const STOP_WORDS = new Set([
  "a",
  "an",
  "the",
  "to",
  "for",
  "of",
  "on",
  "in",
  "at",
  "with",
  "and",
  "or",
  "that",
  "this",
  "named",
  "called",
  "labeled",
  "labelled",
  "saying",
  "says",
  "element",
]);

const normalize = (text: string) => text.toLowerCase().replace(/\s+/gu, " ").trim();

const fieldsOf = (candidate: FindCandidate) =>
  [candidate.name, candidate.value ?? "", candidate.description ?? ""].map(normalize);

// "Results" also finds "result".
const contains = (haystack: string, word: string) =>
  haystack.includes(word) ||
  (word.length > 3 && word.endsWith("s") && haystack.includes(word.slice(0, -1)));

function exactScore(candidate: FindCandidate, query: string): number {
  const [name = ""] = fieldsOf(candidate);
  const fields = [normalize(candidate.role), ...fieldsOf(candidate)];
  if (!fields.some((field) => field.includes(query))) return 0;
  return 10 + (name === query ? 4 : 0) + (candidate.interactive ? 1 : 0);
}

export interface FindScores {
  // 0 for no match.
  readonly scores: number[];
  // Nothing matched the words, so these are the elements of the role the query named.
  readonly byRoleOnly: boolean;
}

function naturalScores(query: string, candidates: readonly FindCandidate[]): FindScores {
  // Identifiers like "A-1043" or "#5000" stay one word.
  const tokens = query
    .split(/[^\p{L}\p{N}#._-]+/u)
    .map((token) => token.replace(/^[._-]+|[._-]+$/gu, ""))
    .filter((token) => token && !STOP_WORDS.has(token));
  const roleTokens: string[] = [];
  const words: string[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    const pair = `${token}${tokens[index + 1] ?? ""}`;
    if (PAIRED_ROLE_WORDS.has(pair) && tokens[index + 1]) {
      roleTokens.push(pair);
      index += 1;
    } else if (ROLE_WORDS[token]) roleTokens.push(token);
    else words.push(token);
  }
  const roles = new Set(roleTokens.flatMap((token) => ROLE_WORDS[token]!));
  // Identifiers like "12" or "A-1043" must match; a long description may miss a word or two.
  // Words found only in the surrounding row count for matching but weigh less.
  const coverage = (candidate: FindCandidate) => {
    const own = fieldsOf(candidate).join("\n");
    const context = normalize(candidate.context ?? "");
    const inOwn = words.map((word) => contains(own, word));
    const hit = words.map((word, index) => inOwn[index] || contains(context, word));
    if (words.some((word, index) => /\p{N}/u.test(word) && !hit[index]))
      return { total: 0, own: 0 };
    return {
      total: hit.filter(Boolean).length / words.length,
      own: inOwn.filter(Boolean).length / words.length,
    };
  };
  const score = (candidate: FindCandidate, covered: { total: number; own: number }) => {
    const [name = ""] = fieldsOf(candidate);
    const roleHit = roles.has(candidate.role);
    return (
      covered.total * 4 +
      covered.own * 2 +
      (roleHit ? 3 : roles.size > 0 ? -1 : 0) +
      (name === words.join(" ") ? 1 : 0) +
      (candidate.interactive ? 0.5 : 0)
    );
  };
  const roleOnly = (candidate: FindCandidate) =>
    roles.has(candidate.role) ? 1 + (candidate.interactive ? 1 : 0) : 0;
  if (words.length === 0) return { scores: candidates.map(roleOnly), byRoleOnly: false };
  const covered = candidates.map(coverage);
  // Elements that match every word outrank, and hide, those that match only some.
  // An identifier that matched is decisive on its own ("order A-1043" finds the A-1043 cell).
  const floor = covered.some(({ total }) => total === 1)
    ? 1
    : words.some((word) => /\p{N}/u.test(word))
      ? 0
      : words.length < 3
        ? 1
        : 0.5;
  const scores = candidates.map((candidate, index) =>
    covered[index]!.total >= floor && covered[index]!.own > 0
      ? score(candidate, covered[index]!)
      : 0,
  );
  if (scores.some((value) => value > 0)) return { scores, byRoleOnly: false };
  // "submit button" on a page whose only button says "Sign up": offer the role's elements.
  return { scores: candidates.map(roleOnly), byRoleOnly: roles.size > 0 };
}

export function scoreCandidates(query: string, candidates: readonly FindCandidate[]): FindScores {
  const needle = normalize(query);
  const exact = candidates.map((candidate) => exactScore(candidate, needle));
  if (exact.some((score) => score > 0)) return { scores: exact, byRoleOnly: false };
  return naturalScores(needle, candidates);
}
