import { describe, expect, it } from "vitest";

import {
  classifyInspectCommand,
  commandReadFilePaths,
  commandReadRange,
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
    ['cd /repo && rg -n "a" src; grep -n "b" lib', "Searched for a, b"],
    [
      "cd /x && grep -rln 'visibility' apps/game/Runtime --include='*.cs' | head -8; grep -rn 'class .*Level.*Dto\\|class LevelPayload\\|class ShelfDto\\|class BookDto' apps/game/Runtime --include='*.cs' | head -8",
      "Searched for visibility, class LevelDto +3 in game/Runtime",
    ],
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
    ["cd /repo && python3 - <<'EOF'\nprint(1)\nEOF", "Ran Python script"],
    [
      "cd /repo && python3 - <<'EOF'\np='CHANGELOG.md'; s=open(p).read()\nopen(p,'w').write(s.replace('a','b'))\nEOF",
      "Edited CHANGELOG.md",
    ],
    ["cd /repo && cat > src/page.tsx <<'EOF'\nexport const a = 1;\nEOF", "Wrote src/page.tsx"],
    [
      "cd /repo && python3 - <<'EOF'\nopen('q.sql','w').write('x')\nEOF\npython3 qtime.py q.sql",
      "Ran qtime.py",
    ],
    ["cd /repo && sed -i '' 's/a/b/' a.ts && bun run check", "Ran bun run check"],
    [
      "cd /repo && python3 - <<'EOF'\np='app.py'; s=open(p).read()\nopen(p,'w').write(s)\nEOF\npython3 -m unittest -v 2>&1 | tail -5",
      "Ran python3 -m unittest -v",
    ],
    [
      "cd /repo && python3 - <<'EOF'\np='src/a.rs'; s=open(p).read()\nopen(p,'w').write(s)\nEOF\ncargo build --release 2>&1 | head -30; cargo test --release 2>&1 | grep -E 'test result'",
      "Ran cargo build --release",
    ],
    ["echo done >> notes.txt", "Appended to notes.txt"],
    ["cd /repo && perl -pi -e 's/a/b/' a.ts b.ts", "Edited 2 files"],
    ["node -e \"require('fs').writeFileSync('out.json', '{}')\"", "Edited out.json"],
    ["python3 scripts/migrate.py --dry-run", "Ran scripts/migrate.py"],
    ["cd /repo && bun run test src/a.test.ts 2>&1 | tail -6", "Ran bun run test src/a.test.ts"],
    ["sqlite3 state.sqlite <<'EOF'\nselect 1;\nEOF", "Queried state.sqlite"],
    ["cd /repo && bun run check > /tmp/check.log 2>&1", "Ran bun run check"],
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
    ["sed -n 40,80p a.ts", { start: 40, end: 80 }],
    ["sed -n '120,$p' a.ts", { start: 120, end: null }],
    ["head -n 20 a.ts", { start: 1, end: 20 }],
    ["tail -30 a.ts", { lastLines: 30 }],
    ["cat a.ts", null],
    ["sed -n 1,5p a.ts b.ts", null],
  ] as const)("reads the range of %s", (command, range) => {
    expect(commandReadRange(command)).toEqual(range);
  });

  it.each([
    ["cd /repo && sed -n 1,20p a.ts; cat b.ts", "read", "inspect"],
    ["cd /repo && cat a.ts; grep -n x b.ts", "read", "inspect"],
    ["cd /repo && grep -n x a.ts; ls src", "search", "inspect"],
    ["cd /repo && ls src; ls lib", "list", "inspect"],
    ["cd /repo && cat a.ts; git log -5", null, "git"],
    ["cd /repo && sed -i '' 's/a/b/' a.ts", null, "terminal"],
    ["cat <<'EOF' | wc -l\nx\nEOF", null, "terminal"],
  ] as const)("classifies %s", (command, kind, visual) => {
    expect(classifyInspectCommand(command)).toBe(kind);
    expect(resolveCommandVisualKind(command)).toBe(visual);
  });
});
