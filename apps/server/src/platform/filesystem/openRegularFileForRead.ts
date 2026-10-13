import { constants } from "node:fs";
import * as fs from "node:fs/promises";
import { Data } from "effect";

export class NotRegularFileError extends Data.TaggedError("NotRegularFileError")<{
  readonly path: string;
}> {
  override get message(): string {
    return "Path is not a regular file.";
  }
}

// A blocking open of a FIFO parks a libuv worker until a writer appears and cannot be cancelled,
// so a few of them starve every other filesystem call. POSIX opens nonblocking and checks the type
// on the descriptor; Windows has no FIFOs at ordinary paths and keeps its plain read flags.
const READ_FLAGS = constants.O_RDONLY | (process.platform === "win32" ? 0 : constants.O_NONBLOCK);
const NO_FOLLOW = process.platform === "win32" ? 0 : constants.O_NOFOLLOW;

export async function openRegularFileForRead(
  path: string,
  options: { readonly noFollow?: boolean } = {},
): Promise<fs.FileHandle> {
  const handle = await fs.open(path, READ_FLAGS | (options.noFollow ? NO_FOLLOW : 0));
  const isRegularFile = await handle.stat().then(
    (stat) => stat.isFile(),
    async (cause: unknown) => {
      await handle.close();
      throw cause;
    },
  );
  if (!isRegularFile) {
    await handle.close();
    throw new NotRegularFileError({ path });
  }
  return handle;
}
