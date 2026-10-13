import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

// Shared code, orchestration and the web must not branch on a provider kind. Provider knowledge
// belongs to the provider's own folder under apps/server/src/provider. Existing leaks are listed in
// the allowlist, which may only shrink: run with --update after removing leaks to lower it.
const providerOwners = [
  { kind: "codex", owner: "codex" },
  { kind: "claudeAgent", owner: "claude" },
  { kind: "opencode", owner: "opencode" },
  { kind: "grok", owner: "grok" },
  // "cursor" is also a CSS property, a pagination field and an editor id, so it only counts where it
  // is used as a provider: compared, matched in a case, or assigned to a provider or kind field.
  { kind: "cursor", owner: "cursor", commonWord: true },
  { kind: "museCode", owner: "muse" },
  { kind: "factoryDroid", owner: "droid" },
] as const satisfies ReadonlyArray<{ kind: string; owner: string; commonWord?: boolean }>;

// The registries are where provider kinds are declared, so they name every provider.
const providerRegistries = new Set([
  "packages/contracts/src/core/baseSchemas.ts",
  "packages/shared/src/provider/providerMetadata.ts",
]);

const root = path.resolve(import.meta.dirname, "../..");
const allowlistPath = path.join(import.meta.dirname, "providerNeutralityAllowlist.json");
const kinds = new Set<string>(providerOwners.map(({ kind }) => kind));
const commonWordKinds = new Set<string>(
  providerOwners.flatMap((owner) =>
    "commonWord" in owner && owner.commonWord ? [owner.kind] : [],
  ),
);

function isProviderUse(node: ts.Node): boolean {
  const parent = node.parent;
  if (ts.isCaseClause(parent)) return true;
  if (ts.isBinaryExpression(parent)) {
    const operator = parent.operatorToken.kind;
    return (
      operator === ts.SyntaxKind.EqualsEqualsEqualsToken ||
      operator === ts.SyntaxKind.ExclamationEqualsEqualsToken ||
      operator === ts.SyntaxKind.EqualsEqualsToken ||
      operator === ts.SyntaxKind.ExclamationEqualsToken
    );
  }
  if (ts.isPropertyAssignment(parent) && parent.initializer === node) {
    return /provider|kind/iu.test(parent.name.getText());
  }
  return ts.isLiteralTypeNode(parent) && ts.isUnionTypeNode(parent.parent);
}
const owners = providerOwners.map(({ owner }) => owner);

function isProviderOwned(file: string): boolean {
  if (!file.startsWith("apps/server/src/provider/")) return false;
  const segments = file.split("/");
  const basename = segments.at(-1)!.toLowerCase();
  return owners.some((owner) => segments.includes(owner) || basename.startsWith(owner));
}

function isTestCode(file: string): boolean {
  return /\.(?:test|integration)\.|testSupport|TestSupport|TestFixtures|\/tests\//u.test(file);
}

function countProviderLiterals(file: string): number {
  const source = ts.createSourceFile(
    file,
    readFileSync(path.join(root, file), "utf8"),
    ts.ScriptTarget.Latest,
    true,
    file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  let count = 0;
  const visit = (node: ts.Node): void => {
    if (
      (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) &&
      kinds.has(node.text) &&
      (!commonWordKinds.has(node.text) || isProviderUse(node))
    ) {
      count += 1;
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return count;
}

const files = execFileSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
  {
    cwd: root,
    encoding: "utf8",
  },
)
  .split("\0")
  .filter((file) => /^(?:apps|packages)\/[^/]+\/src\/.+\.(?:ts|tsx)$/u.test(file))
  .filter((file) => existsSync(path.join(root, file)))
  .filter((file) => !isTestCode(file) && !isProviderOwned(file) && !providerRegistries.has(file));

const actual = new Map<string, number>();
for (const file of files) {
  const count = countProviderLiterals(file);
  if (count > 0) actual.set(file, count);
}

const allowed: Record<string, number> = existsSync(allowlistPath)
  ? (JSON.parse(readFileSync(allowlistPath, "utf8")) as Record<string, number>)
  : {};
const leaks: string[] = [];
const stale: string[] = [];
for (const [file, count] of actual) {
  const limit = allowed[file] ?? 0;
  if (count > limit) leaks.push(`${file}: ${count} provider-kind literal(s), allowed ${limit}`);
}
for (const [file, limit] of Object.entries(allowed)) {
  const count = actual.get(file) ?? 0;
  if (count < limit) stale.push(`${file}: allowed ${limit}, found ${count}`);
}

if (leaks.length > 0) {
  console.error(
    [
      "Provider-kind literals outside provider-owned code. Use a capability or provider metadata:",
      ...leaks.map((leak) => `  ${leak}`),
    ].join("\n"),
  );
  process.exitCode = 1;
} else if (stale.length > 0 && process.argv.includes("--update")) {
  const lowered = Object.fromEntries(
    Object.keys(allowed)
      .filter((file) => actual.has(file))
      .toSorted()
      .map((file) => [file, actual.get(file)!]),
  );
  writeFileSync(allowlistPath, `${JSON.stringify(lowered, null, 2)}\n`);
  console.log(`Lowered the provider neutrality allowlist for ${stale.length} file(s).`);
} else if (stale.length > 0) {
  console.error(
    [
      "The provider neutrality allowlist is above the current count. Lower it with",
      "`bun scripts/checks/providerNeutrality.ts --update`:",
      ...stale.map((entry) => `  ${entry}`),
    ].join("\n"),
  );
  process.exitCode = 1;
} else {
  const total = [...actual.values()].reduce((sum, count) => sum + count, 0);
  console.log(
    `Provider neutrality verified: ${total} allowlisted literal(s) in ${actual.size} files.`,
  );
}
