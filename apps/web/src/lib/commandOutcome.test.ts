import { describe, expect, it } from "vitest";

import { describeCommandOutcome, parseSearchMatches } from "./commandOutcome";

// Output shapes taken from real runs.
describe("describeCommandOutcome", () => {
  it.each([
    [
      "vitest",
      "bun run test",
      " Test Files  50 passed (50)\n      Tests  449 passed (449)\n   Duration  4s",
      false,
      "449 passed",
    ],
    [
      "vitest with failures",
      "cd /repo && bun run test",
      "Exit code 1\n Test Files  1 failed | 49 passed (50)\n      Tests  1 failed | 395 passed (396)",
      true,
      "1 failed, 395 passed",
    ],
    [
      "turbo runs one vitest per package",
      "bun run test",
      "@glade/web:test:       Tests  10 passed (10)\n@glade/cli:test:       Tests  5 passed | 1 skipped (6)",
      false,
      "15 passed",
    ],
    [
      "coloured output",
      "bun run test",
      "u001b[2m      Tests u001b[22m u001b[1mu001b[32m3 passedu001b[39mu001b[22mu001b[90m (3)u001b[39m",
      false,
      "3 passed",
    ],
    ["jest", "npx jest", "Tests:       2 failed, 10 passed, 12 total", true, "2 failed, 10 passed"],
    [
      "pytest",
      "pytest -q",
      "===== 2 failed, 10 passed in 1.23s =====",
      true,
      "2 failed, 10 passed",
    ],
    ["bun test", "bun test", " 12 pass\n 0 fail\nRan 12 tests", false, "12 passed"],
    ["oxlint", "bunx oxlint src", "Found 2 warnings and 3 errors.", true, "3 errors, 2 warnings"],
    [
      "tsc",
      "npx tsc --noEmit",
      "a.ts(1,1): error TS2304\nFound 1 error in a.ts:1",
      true,
      "1 error",
    ],
    ["a clean check adds nothing", "bun run check", "Found 0 warnings and 0 errors.", false, null],
    ["a summary-shaped line in a commit", "git log -1", "      Tests  3 passed (3)", false, null],
    [
      "the error line of a failure",
      "cd /tmp && magick a.png b.png",
      "Exit code 1\nconverting\nmagick: unable to open image 'a.png': No such file or directory",
      true,
      "magick: unable to open image 'a.png': No such file or directory",
    ],
    [
      "a failure without an error line",
      "ls *.md; grep -q x y",
      "Exit code 1\nAGENTS.md",
      true,
      "exit 1",
    ],
    [
      "a blocked tool call",
      "sleep 45; grep x log",
      "<tool_use_error>Blocked: sleep 45 followed by grep</tool_use_error>",
      true,
      "Blocked: sleep 45 followed by grep",
    ],
    ["a search that found nothing", "grep -rn needle src", "Exit code 1", true, "no matches"],
    [
      "search matches across files",
      "rg -n needle src",
      "src/a.ts:3:needle\nsrc/b.ts:9:needle again\nsrc/b.ts:12:needle",
      false,
      "3 matches in 2 files",
    ],
    ["matches in one file", "grep -n needle src/a.ts", "3:needle\n9:needle", false, "2 matches"],
    [
      "a list cut by head",
      "grep -rln needle src | head -2",
      "src/a.ts\nsrc/b.ts",
      false,
      "2+ files",
    ],
  ])("%s", (_name, command, output, failed, expected) => {
    expect(describeCommandOutcome({ command, output: { output }, failed })?.text ?? null).toBe(
      expected,
    );
  });
});

describe("parseSearchMatches", () => {
  it("reads file, line and text, and leaves out -A/-B context lines", () => {
    expect(
      parseSearchMatches(["src/a.ts:3:const a = 1;", "src/a.ts-4-next line", "--"], {
        listsFiles: false,
        singleFile: null,
      }),
    ).toEqual([{ file: "src/a.ts", line: 3, text: "const a = 1;" }]);
  });
});
