import { describe, expect, it } from "vitest";

import { parseVisualFormula } from "./visualFormula";

const evaluate = (source: string, scope: Record<string, number> = {}) => {
  const parsed = parseVisualFormula(source);
  if (!parsed.ok) throw new Error(parsed.message);
  return parsed.formula.evaluate(scope);
};

describe("parseVisualFormula", () => {
  it.each([
    ["1 + 2 * 3", 7],
    ["(1 + 2) * 3", 9],
    ["10 - 4 - 3", 3],
    ["2 ^ 3 ^ 2", 512],
    ["-2 ^ 2", -4],
    ["2 ^ -1", 0.5],
    ["7 % 4", 3],
    ["1 + 1 == 2 && !(3 < 2)", 1],
    ["0 || 0", 0],
    ["if(rate > 5, 1, 2)", 1],
    ["round(pi, 2)", 3.14],
    ["clamp(rate, 0, 3)", 3],
    ["max(1, rate, 4) + min(2, 1)", 7],
    ["1.5e2 + .5", 150.5],
    ["principal * r / (1 - (1 + r) ^ -months)", 1000 * 0.01 * (1 / (1 - 1.01 ** -12))],
  ])("evaluates %s", (source, expected) => {
    expect(evaluate(source, { rate: 6, principal: 1000, r: 0.01, months: 12 })).toBeCloseTo(
      expected,
      10,
    );
  });

  it("reports the variables a formula reads, without constants", () => {
    const parsed = parseVisualFormula("a * pi + max(b, 2)");
    expect(parsed.ok && [...parsed.formula.names]).toEqual(["a", "b"]);
  });

  it.each(["1 +", "(1", "1 2", "foo(1)", "round()", "1 $ 2", "if(1, 2)"])(
    "rejects %s",
    (source) => {
      expect(parseVisualFormula(source).ok).toBe(false);
    },
  );
});
