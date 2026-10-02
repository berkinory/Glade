import type {
  GitSourceControlFilesResult,
  GitSourceControlFileStatus,
} from "@glade/contracts/git/git";

const fileNames = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
const NORMAL_LIMIT = 5_000;
const RESULT_LIMIT = 200;

type File = GitSourceControlFilesResult["staged"][number];

function sortFiles(files: File[]): File[] {
  return files
    .map((file) => {
      const parts = file.path.split("/");
      return { file, parts, directories: parts.map((part) => part.toLowerCase()) };
    })
    .toSorted((a, b) => {
      for (let index = 0; ; index += 1) {
        const endA = index === a.parts.length - 1;
        const endB = index === b.parts.length - 1;
        if (endA && endB) {
          const left = a.parts[index]!;
          const right = b.parts[index]!;
          return fileNames.compare(left, right) || (left === right ? 0 : left < right ? -1 : 1);
        }
        if (endA) return -1;
        if (endB) return 1;
        const left = a.directories[index]!;
        const right = b.directories[index]!;
        if (left !== right) return left < right ? -1 : 1;
      }
    })
    .map(({ file }) => file);
}

function letter(code: string): GitSourceControlFileStatus {
  if (code === "?" || code === "U") return "U";
  if (["A", "D", "R", "C", "T"].includes(code)) return code as GitSourceControlFileStatus;
  return "M";
}

export function sourceControlInventory(query = "") {
  const needle = query.toLowerCase();
  let count = 0;
  let stagedCount = 0;
  let unstagedCount = 0;
  let matches = 0;
  let renameSource = false;
  let large = false;
  const staged: File[] = [];
  const unstaged: File[] = [];
  const folders = new Map<string, number>();
  let otherFolders = 0;
  return {
    accept(record: string) {
      if (renameSource) {
        renameSource = false;
        return;
      }
      if (record.length < 4) return;
      const code = record.slice(0, 2);
      const path = record.slice(3);
      renameSource = code.includes("R") || code.includes("C");
      const inIndex = code[0] !== " " && code[0] !== "?";
      const inTree = code[1] !== " " || code === "??";
      count += 1;
      if (inIndex) stagedCount += 1;
      if (inTree) unstagedCount += 1;
      if (count === NORMAL_LIMIT) {
        large = true;
        staged.splice(RESULT_LIMIT);
        unstaged.splice(RESULT_LIMIT);
      }
      const folder = path.includes("/") ? path.slice(0, path.indexOf("/")) : "(root)";
      if (folders.has(folder) || folders.size < 64)
        folders.set(folder, (folders.get(folder) ?? 0) + 1);
      else otherFolders += 1;
      if (needle && !path.toLowerCase().includes(needle)) return;
      matches += 1;
      const conflict = /^(AA|DD|AU|UA|DU|UD|UU)$/.test(code);
      const limit = large || needle ? RESULT_LIMIT : NORMAL_LIMIT;
      const add = (files: File[], status: string) => {
        if (files.length < limit)
          files.push({
            path,
            status: conflict ? "!" : letter(status),
            insertions: 0,
            deletions: 0,
          });
      };
      if (inIndex) add(staged, code[0]!);
      if (inTree) add(unstaged, code[1]!);
    },
    result(incomplete: boolean): GitSourceControlFilesResult {
      if (incomplete) {
        staged.splice(RESULT_LIMIT);
        unstaged.splice(RESULT_LIMIT);
      }
      return {
        staged: sortFiles(staged),
        unstaged: sortFiles(unstaged),
        coverage: {
          mode: large || incomplete ? "large" : "normal",
          count,
          stagedCount,
          unstagedCount,
          incomplete,
          matches,
          resultsLimited: matches > new Set([...staged, ...unstaged].map((file) => file.path)).size,
          folders: [...folders].map(([path, count]) => ({ path, count })),
          otherFolders,
        },
        statsAvailable: false,
      };
    },
  };
}
