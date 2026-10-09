import type { DesktopPairedMachine } from "@glade/contracts/ipc/pairedMachines";
import { Option, Schema } from "effect";
import { safeStorage } from "electron";
import * as FS from "node:fs";
import * as Path from "node:path";

const StoredMachine = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
  environmentId: Schema.String,
  address: Schema.String,
  routes: Schema.Array(Schema.String),
  // The session token, encrypted with the OS keychain through Electron's safeStorage.
  sessionToken: Schema.String,
});
type StoredMachine = typeof StoredMachine.Type;

const MachinesFile = Schema.Struct({
  version: Schema.Literal(1),
  machines: Schema.Array(StoredMachine),
});
const decodeMachinesFile = Schema.decodeUnknownOption(Schema.fromJsonString(MachinesFile));

export interface PairedMachineRecord extends DesktopPairedMachine {
  readonly routes: ReadonlyArray<string>;
  // Null when the keychain no longer opens it (a reset keychain, a copied profile); the machine then
  // has to be paired again, but stays listed so it can be.
  readonly sessionToken: string | null;
}

export interface PairedMachinesStore {
  list(): ReadonlyArray<PairedMachineRecord>;
  get(id: string): PairedMachineRecord | null;
  put(record: PairedMachineRecord & { readonly sessionToken: string }): void;
  remove(id: string): void;
}

function requireEncryption(): void {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("This system has no secure storage for the machine's sign-in.");
  }
}

export function createPairedMachinesStore(filePath: string): PairedMachinesStore {
  function readFile(): ReadonlyArray<StoredMachine> {
    let contents: string;
    try {
      contents = FS.readFileSync(filePath, "utf8");
    } catch {
      return [];
    }
    const decoded = decodeMachinesFile(contents);
    if (Option.isNone(decoded))
      throw new Error(`The paired machines in ${filePath} are not valid.`);
    return decoded.value.machines;
  }

  function write(machines: ReadonlyArray<StoredMachine>): void {
    FS.mkdirSync(Path.dirname(filePath), { recursive: true });
    const temporary = `${filePath}.${process.pid}.tmp`;
    FS.writeFileSync(temporary, `${JSON.stringify({ version: 1, machines }, null, 2)}\n`, {
      mode: 0o600,
    });
    FS.renameSync(temporary, filePath);
  }

  const readToken = (encrypted: string): string | null => {
    if (!safeStorage.isEncryptionAvailable()) return null;
    try {
      return safeStorage.decryptString(Buffer.from(encrypted, "base64"));
    } catch {
      return null;
    }
  };

  const toRecord = (stored: StoredMachine): PairedMachineRecord => ({
    id: stored.id,
    label: stored.label,
    environmentId: stored.environmentId,
    address: stored.address,
    routes: stored.routes,
    sessionToken: readToken(stored.sessionToken),
  });

  return {
    list: () => readFile().map(toRecord),
    get: (id) => {
      const stored = readFile().find((machine) => machine.id === id);
      return stored ? toRecord(stored) : null;
    },
    put: (record) => {
      requireEncryption();
      const stored: StoredMachine = {
        id: record.id,
        label: record.label,
        environmentId: record.environmentId,
        address: record.address,
        routes: [...record.routes],
        sessionToken: safeStorage.encryptString(record.sessionToken).toString("base64"),
      };
      write([...readFile().filter((machine) => machine.id !== record.id), stored]);
    },
    remove: (id) => write(readFile().filter((machine) => machine.id !== id)),
  };
}
