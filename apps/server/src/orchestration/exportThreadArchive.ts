import zlib from "node:zlib";

import type {
  OrchestrationMessage,
  OrchestrationThread,
} from "@glade/contracts/orchestration/orchestration";

interface ThreadArchiveEntry {
  readonly name: string;
  readonly chunks: Iterable<string>;
}

const u16 = (value: number): Buffer => {
  const buffer = Buffer.alloc(2);
  buffer.writeUInt16LE(value >>> 0, 0);
  return buffer;
};

const u32 = (value: number): Buffer => {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(value >>> 0, 0);
  return buffer;
};

const UTF8_FLAG = 0x0800;

interface DeflatedEntryData {
  readonly compressed: Buffer;
  readonly crc: number;
  readonly uncompressedSize: number;
}

async function deflateEntryChunks(chunks: Iterable<string>): Promise<DeflatedEntryData> {
  const deflater = zlib.createDeflateRaw();
  const compressedChunks: Buffer[] = [];
  deflater.on("data", (chunk: Buffer) => compressedChunks.push(chunk));
  const finished = new Promise<void>((resolve, reject) => {
    deflater.once("end", resolve);
    deflater.once("error", reject);
  });

  let crc = 0;
  let uncompressedSize = 0;
  for (const chunk of chunks) {
    const buffer = Buffer.from(chunk, "utf8");
    crc = zlib.crc32(buffer, crc) >>> 0;
    uncompressedSize += buffer.length;
    if (!deflater.write(buffer)) {
      await new Promise<void>((resolve) => deflater.once("drain", resolve));
    }
  }
  deflater.end();
  await finished;

  return { compressed: Buffer.concat(compressedChunks), crc, uncompressedSize };
}

interface ZipEntryRecord {
  readonly localChunk: Buffer;
  readonly centralRecord: (offset: number) => Buffer;
}

async function buildZipEntry(entry: ThreadArchiveEntry): Promise<ZipEntryRecord> {
  const nameBuffer = Buffer.from(entry.name, "utf8");
  const { compressed, crc, uncompressedSize } = await deflateEntryChunks(entry.chunks);
  const method = 8;

  const localChunk = Buffer.concat([
    u32(0x04034b50),
    u16(20),
    u16(UTF8_FLAG),
    u16(method),
    u16(0),
    u16(0),
    u32(crc),
    u32(compressed.length),
    u32(uncompressedSize),
    u16(nameBuffer.length),
    u16(0),
    nameBuffer,
    compressed,
  ]);

  const centralRecord = (offset: number): Buffer =>
    Buffer.concat([
      u32(0x02014b50),
      u16(20),
      u16(20),
      u16(UTF8_FLAG),
      u16(method),
      u16(0),
      u16(0),
      u32(crc),
      u32(compressed.length),
      u32(uncompressedSize),
      u16(nameBuffer.length),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(0),
      u32(offset),
      nameBuffer,
    ]);

  return { localChunk, centralRecord };
}

const MESSAGE_ROLE_HEADING: Record<string, string> = {
  user: "User",
  assistant: "Assistant",
  system: "System",
};

function* transcriptMarkdownChunks(thread: OrchestrationThread): Generator<string> {
  yield `# ${thread.title}\n\n> Exported from Glade.\n`;
  for (const message of thread.messages) {
    const heading = MESSAGE_ROLE_HEADING[message.role] ?? "Message";
    yield `\n## ${heading} \`${message.createdAt}\`\n\n${message.text}\n`;
  }
}

function exportMessageProjection(message: OrchestrationMessage): Record<string, unknown> {
  return {
    id: message.id,
    role: message.role,
    text: message.text,
    source: message.source,

    ...(message.attachments?.length ? { attachments: message.attachments } : {}),
    ...(message.skills?.length ? { skills: message.skills } : {}),
    ...(message.mentions?.length ? { mentions: message.mentions } : {}),
    createdAt: message.createdAt,
    updatedAt: message.updatedAt,
  };
}

function* threadJsonChunks(thread: OrchestrationThread): Generator<string> {
  const metadata = JSON.stringify(
    {
      threadId: thread.id,
      title: thread.title,
      modelSelection: thread.modelSelection,
      runtimeMode: thread.runtimeMode,
      createdAt: thread.createdAt,
      updatedAt: thread.updatedAt,
    },
    null,
    2,
  );

  yield `${metadata.slice(0, -2)},\n  "messages": [`;

  let first = true;
  for (const message of thread.messages) {
    const messageJson = JSON.stringify(exportMessageProjection(message), null, 2)
      .split("\n")
      .map((line) => `    ${line}`)
      .join("\n");
    yield `${first ? "" : ","}\n${messageJson}`;
    first = false;
  }

  yield "\n  ]\n}";
}

function threadArchiveEntries(thread: OrchestrationThread): ThreadArchiveEntry[] {
  return [
    { name: "thread.json", chunks: threadJsonChunks(thread) },
    { name: "transcript.md", chunks: transcriptMarkdownChunks(thread) },
  ];
}

export async function* threadArchiveChunks(thread: OrchestrationThread): AsyncGenerator<Buffer> {
  const centralRecords: Buffer[] = [];
  let offset = 0;
  let entryCount = 0;

  for (const entry of threadArchiveEntries(thread)) {
    const { localChunk, centralRecord } = await buildZipEntry(entry);
    centralRecords.push(centralRecord(offset));
    offset += localChunk.length;
    entryCount += 1;
    yield localChunk;
  }

  const centralDirectoryBody = Buffer.concat(centralRecords);
  yield centralDirectoryBody;

  yield Buffer.concat([
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(entryCount),
    u16(entryCount),
    u32(centralDirectoryBody.length),
    u32(offset),
    u16(0),
  ]);
}

const FILENAME_SAFE_REPLACE = /[^a-z0-9-]+/g;

function slugifyTitle(title: string): string {
  const slug = title
    .toLowerCase()
    .trim()
    .replace(FILENAME_SAFE_REPLACE, "-")
    .replace(/^-+|-+$/g, "");
  return slug.length > 0 ? slug.slice(0, 48) : "thread";
}

export function threadArchiveFileName(input: {
  readonly title: string;
  readonly isoTimestamp: string;
}): string {
  const dateBucket = input.isoTimestamp.slice(0, 10).replaceAll("-", "");
  return `glade-thread-${slugifyTitle(input.title)}-${dateBucket}.zip`;
}
