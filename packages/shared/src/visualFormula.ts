type BinaryOperator =
  | "||"
  | "&&"
  | "=="
  | "!="
  | "<"
  | "<="
  | ">"
  | ">="
  | "+"
  | "-"
  | "*"
  | "/"
  | "%"
  | "^";

type FormulaNode =
  | { readonly kind: "number"; readonly value: number }
  | { readonly kind: "name"; readonly name: string }
  | { readonly kind: "unary"; readonly operator: "-" | "!"; readonly operand: FormulaNode }
  | {
      readonly kind: "binary";
      readonly operator: BinaryOperator;
      readonly left: FormulaNode;
      readonly right: FormulaNode;
    }
  | { readonly kind: "call"; readonly name: string; readonly args: readonly FormulaNode[] };

const PRECEDENCE: Readonly<Record<BinaryOperator, number>> = {
  "||": 1,
  "&&": 2,
  "==": 3,
  "!=": 3,
  "<": 4,
  "<=": 4,
  ">": 4,
  ">=": 4,
  "+": 5,
  "-": 5,
  "*": 6,
  "/": 6,
  "%": 6,
  "^": 8,
};
const UNARY_PRECEDENCE = 7;

const FUNCTIONS: Readonly<
  Record<
    string,
    { readonly arity: readonly [number, number]; readonly apply: (args: number[]) => number }
  >
> = {
  abs: { arity: [1, 1], apply: ([x]) => Math.abs(x!) },
  sqrt: { arity: [1, 1], apply: ([x]) => Math.sqrt(x!) },
  floor: { arity: [1, 1], apply: ([x]) => Math.floor(x!) },
  ceil: { arity: [1, 1], apply: ([x]) => Math.ceil(x!) },
  exp: { arity: [1, 1], apply: ([x]) => Math.exp(x!) },
  log: { arity: [1, 1], apply: ([x]) => Math.log(x!) },
  round: {
    arity: [1, 2],
    apply: ([x, digits = 0]) => Math.round(x! * 10 ** digits) / 10 ** digits,
  },
  pow: { arity: [2, 2], apply: ([x, y]) => x! ** y! },
  min: { arity: [1, 8], apply: (args) => Math.min(...args) },
  max: { arity: [1, 8], apply: (args) => Math.max(...args) },
  clamp: { arity: [3, 3], apply: ([x, lo, hi]) => Math.min(hi!, Math.max(lo!, x!)) },
  if: { arity: [3, 3], apply: ([condition, then, otherwise]) => (condition ? then! : otherwise!) },
};

const CONSTANTS: Readonly<Record<string, number>> = { pi: Math.PI };

/** Names a formula cannot use for its own variables. */
export const VISUAL_FORMULA_RESERVED_NAMES: ReadonlySet<string> = new Set([
  ...Object.keys(FUNCTIONS),
  ...Object.keys(CONSTANTS),
]);

const TOKEN =
  /\s*(?:(\d+(?:\.\d*)?(?:[eE][+-]?\d+)?|\.\d+(?:[eE][+-]?\d+)?)|([A-Za-z_]\w*)|(<=|>=|==|!=|&&|\|\||[-+*/%^()<>!,]))/y;

type Token =
  | { readonly kind: "number"; readonly value: number }
  | { readonly kind: "name"; readonly name: string }
  | { readonly kind: "symbol"; readonly symbol: string };

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  TOKEN.lastIndex = 0;
  while (TOKEN.lastIndex < source.length) {
    if (!source.slice(TOKEN.lastIndex).trim()) break;
    const at = TOKEN.lastIndex;
    const match = TOKEN.exec(source);
    if (!match)
      throw new Error(`Unexpected "${source.slice(at).trim()[0]}" at position ${at + 1}.`);
    if (match[1] !== undefined) tokens.push({ kind: "number", value: Number(match[1]) });
    else if (match[2] !== undefined) tokens.push({ kind: "name", name: match[2] });
    else tokens.push({ kind: "symbol", symbol: match[3]! });
  }
  return tokens;
}

function parseTokens(tokens: readonly Token[]): FormulaNode {
  let position = 0;
  const peekSymbol = () => {
    const token = tokens[position];
    return token?.kind === "symbol" ? token.symbol : undefined;
  };
  const expect = (symbol: string) => {
    if (peekSymbol() !== symbol) throw new Error(`Expected "${symbol}".`);
    position += 1;
  };
  const prefix = (): FormulaNode => {
    const token = tokens[position];
    position += 1;
    if (!token) throw new Error("The formula ends unexpectedly.");
    if (token.kind === "number") return { kind: "number", value: token.value };
    if (token.kind === "name") {
      if (peekSymbol() !== "(") return { kind: "name", name: token.name };
      const fn = FUNCTIONS[token.name];
      if (!fn) throw new Error(`Unknown function "${token.name}".`);
      position += 1;
      const args: FormulaNode[] = [];
      if (peekSymbol() !== ")") {
        args.push(expression(0));
        while (peekSymbol() === ",") {
          position += 1;
          args.push(expression(0));
        }
      }
      expect(")");
      if (args.length < fn.arity[0] || args.length > fn.arity[1])
        throw new Error(`${token.name}() takes ${fn.arity.join(" to ")} arguments.`);
      return { kind: "call", name: token.name, args };
    }
    if (token.symbol === "(") {
      const inner = expression(0);
      expect(")");
      return inner;
    }
    if (token.symbol === "-" || token.symbol === "!")
      return { kind: "unary", operator: token.symbol, operand: expression(UNARY_PRECEDENCE) };
    throw new Error(`Unexpected "${token.symbol}".`);
  };
  const expression = (minimum: number): FormulaNode => {
    let left = prefix();
    for (;;) {
      const operator = peekSymbol() as BinaryOperator | undefined;
      const precedence = operator ? PRECEDENCE[operator] : undefined;
      if (!operator || precedence === undefined || precedence < minimum) return left;
      position += 1;
      // `^` is right-associative; every other operator groups to the left.
      const right = expression(operator === "^" ? precedence : precedence + 1);
      left = { kind: "binary", operator, left, right };
    }
  };
  const root = expression(0);
  if (position < tokens.length) throw new Error("Unexpected input after the formula.");
  return root;
}

function binary(operator: BinaryOperator, left: number, right: number): number {
  switch (operator) {
    case "||":
      return left !== 0 || right !== 0 ? 1 : 0;
    case "&&":
      return left !== 0 && right !== 0 ? 1 : 0;
    case "==":
      return left === right ? 1 : 0;
    case "!=":
      return left !== right ? 1 : 0;
    case "<":
      return left < right ? 1 : 0;
    case "<=":
      return left <= right ? 1 : 0;
    case ">":
      return left > right ? 1 : 0;
    case ">=":
      return left >= right ? 1 : 0;
    case "+":
      return left + right;
    case "-":
      return left - right;
    case "*":
      return left * right;
    case "/":
      return left / right;
    case "%":
      return left % right;
    case "^":
      return left ** right;
  }
}

function evaluateNode(node: FormulaNode, scope: Readonly<Record<string, number>>): number {
  switch (node.kind) {
    case "number":
      return node.value;
    case "name":
      return CONSTANTS[node.name] ?? scope[node.name] ?? Number.NaN;
    case "unary": {
      const operand = evaluateNode(node.operand, scope);
      return node.operator === "-" ? -operand : operand === 0 ? 1 : 0;
    }
    case "binary":
      return binary(node.operator, evaluateNode(node.left, scope), evaluateNode(node.right, scope));
    case "call":
      return FUNCTIONS[node.name]!.apply(node.args.map((arg) => evaluateNode(arg, scope)));
  }
}

function collectNames(node: FormulaNode, names: Set<string>): Set<string> {
  if (node.kind === "name" && !(node.name in CONSTANTS)) names.add(node.name);
  if (node.kind === "unary") collectNames(node.operand, names);
  if (node.kind === "binary") {
    collectNames(node.left, names);
    collectNames(node.right, names);
  }
  if (node.kind === "call") for (const arg of node.args) collectNames(arg, names);
  return names;
}

export interface VisualFormula {
  /** Variables the formula reads; a missing variable evaluates to NaN. */
  readonly names: ReadonlySet<string>;
  readonly evaluate: (scope: Readonly<Record<string, number>>) => number;
}

/**
 * Agents write these formulas and readers' clients evaluate them, so the language is plain
 * arithmetic over numbers with a fixed function list: nothing reaches JavaScript evaluation.
 * Comparisons and logic yield 1 or 0, and any non-zero value counts as true.
 */
export function parseVisualFormula(
  source: string,
):
  | { readonly ok: true; readonly formula: VisualFormula }
  | { readonly ok: false; readonly message: string } {
  try {
    const root = parseTokens(tokenize(source));
    return {
      ok: true,
      formula: {
        names: collectNames(root, new Set()),
        evaluate: (scope) => evaluateNode(root, scope),
      },
    };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}
