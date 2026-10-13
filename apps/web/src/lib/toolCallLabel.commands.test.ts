import { describe, expect, it } from "vitest";

import {
  classifyInspectCommand,
  commandReadFilePaths,
  deriveReadableCommandDisplay,
  resolveCommandVisualKind,
} from "./toolCallLabel.commands";

// Shapes taken from real agent commands: they almost always start with `cd`, chain several steps
// and pipe output through filters.
describe("command labels", () => {
  it.each([
    ["sed -n 1,40p apps/web/src/index.css", "Read src/index.css"],
    [
      "cd /repo && sed -n 1,110p a/conversationEdit.ts; sed -n 160,290p a/conversationEdit.ts",
      "Read a/conversationEdit.ts",
    ],
    ["cd /repo && sed -n 1,20p a.ts; cat b.ts | head -50", "Read 2 files"],
    ["cat a.ts b.ts c.ts", "Read 3 files"],
    ["head -n 20 a.ts b.ts", "Read 2 files"],
    ["sed -n 1,30p a.ts b.ts", "Read 2 files"],
    ["sed -ne 's/x/y/p' a.ts", "Read a.ts"],
    ['cd /repo && grep -rn "needle" apps/web/src | head -20', "Searched for needle in web/src"],
    ['cd /repo && rg -n "a" src; grep -n "b" lib', "Searched 2 times"],
    [
      `cd /repo && grep -rEln "[\\"'](claudeAgent|codex)[\\"']" apps/web/src apps/server/src/orchestration packages/shared/src | grep -v "\\.test\\." | while read f; do echo "$(grep -cE x $f) $f"; done | sort -rn | head -30`,
      "Found files with claudeAgent or codex in web/src +2",
    ],
    [
      'grep -n "error\\|unavailable" apps/server/src/cache.ts',
      "Searched for error or unavailable in src/cache.ts",
    ],
    [
      'cd /repo && cat .gitignore | head -40; grep -n "explore" .git/info/exclude',
      "Explored .gitignore",
    ],
    ["ls ~/.glade ~/.glade/* 2>/dev/null | head -50", "Listed .glade/*"],
    ["cd /repo && git log --oneline -8 && git status -sb | head -1", "Reviewed git history"],
    ["cd /repo && sed -n 1,30p CHANGELOG.md; git status --short", "Checked git status"],
    ["cd /repo && bun run test 2>&1 | tail -20", "Ran bun run test"],
    ["cd /repo && sed -i '' 's/old value/new value/' apps/web/src/a.ts", "Edited src/a.ts"],
    ["cd /repo && for f in *.png; do magick $f info:; done", "Ran magick $f info:"],
    ["cd /repo && python3 - <<'EOF'\nprint(1)\nEOF", "Ran python script"],
    ["cat <<'EOF' | wc -l\nlorem\nEOF", "Ran cat <<'EOF'"],
    ["/bin/zsh -lc 'cd /repo && cat package.json'", "Read package.json"],
  ])("%s", (command, label) => {
    const display = deriveReadableCommandDisplay(command);
    expect(`${display.verb} ${display.target}`).toBe(label);
  });

  it.each([
    ["cd /repo && sed -n 1,20p a.ts; sed -n 5,9p a.ts; cat ./b.ts", ["/repo/a.ts", "/repo/b.ts"]],
    ["head -n 20 src/a.ts /abs/b.ts", ["src/a.ts", "/abs/b.ts"]],
    ["cd /repo && grep -n x a.ts; git log -3", []],
  ] as const)("reads files of %s", (command, files) => {
    expect(commandReadFilePaths(command)).toEqual(files);
  });

  it.each([
    ["cd /repo && sed -n 1,20p a.ts; cat b.ts", "read", "inspect"],
    ["cd /repo && cat a.ts; grep -n x b.ts", "search", "inspect"],
    ["cd /repo && ls src; ls lib", "list", "inspect"],
    ["cd /repo && cat a.ts; git log -5", null, "git"],
    ["cd /repo && sed -i '' 's/a/b/' a.ts", null, "terminal"],
    ["cat <<'EOF' | wc -l\nx\nEOF", null, "terminal"],
  ] as const)("classifies %s", (command, kind, visual) => {
    expect(classifyInspectCommand(command)).toBe(kind);
    expect(resolveCommandVisualKind(command)).toBe(visual);
  });
});
