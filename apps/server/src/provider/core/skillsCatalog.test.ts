import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as nodePath from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { discoverSkillsCatalog } from "./skillsCatalog.ts";

const SKILLS: Record<string, string> = {
  "block-scalars": `---
name: check-code
description: >-
  Review recent changes
  before merging.
metadata:
  short-description: Quick review
  env:
    - name: API_KEY
      description: nested values never override top-level ones
disable-model-invocation: true
---
Body
`,
  "loose-colon": `---
name: loose
description: Use when: the user asks
  nested: ignored
---
`,
  "alias-bomb": `---
name: bomb
a: &a [x, x, x, x, x, x, x, x]
b: &b [*a, *a, *a, *a, *a, *a, *a, *a]
c: &c [*b, *b, *b, *b, *b, *b, *b, *b]
d: [*c, *c, *c, *c, *c, *c, *c, *c]
---
`,
  oversized: `---\nname: huge\ndescription: ${"x".repeat(70 * 1024)}\n---\n`,
};

describe("discoverSkillsCatalog frontmatter", () => {
  let homeDir: string;

  beforeAll(async () => {
    homeDir = await fs.mkdtemp(nodePath.join(os.tmpdir(), "glade-skills-"));
    for (const [folder, contents] of Object.entries(SKILLS)) {
      const dir = nodePath.join(homeDir, ".codex", "skills", folder);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(nodePath.join(dir, "SKILL.md"), contents);
    }
  });

  afterAll(async () => {
    await fs.rm(homeDir, { recursive: true, force: true });
  });

  it("reads valid YAML, tolerates loose scalars and rejects over-limit frontmatter", async () => {
    const skills = await discoverSkillsCatalog({
      homeDir,
      gladeBaseDir: nodePath.join(homeDir, ".glade"),
      provider: "codex",
      forceReload: true,
    });
    const byFolder = Object.fromEntries(
      skills.map((skill) => [nodePath.basename(nodePath.dirname(skill.path)), skill]),
    );

    expect(byFolder["block-scalars"]).toMatchObject({
      name: "check-code",
      description: "Review recent changes before merging.",
      enabled: false,
      interface: { shortDescription: "Quick review" },
    });
    expect(byFolder["loose-colon"]).toMatchObject({
      name: "loose",
      description: "Use when: the user asks",
    });
    for (const folder of ["alias-bomb", "oversized"]) {
      expect(byFolder[folder]).toMatchObject({ name: folder, enabled: true });
      expect(byFolder[folder]?.description).toBeUndefined();
    }
  });
});
