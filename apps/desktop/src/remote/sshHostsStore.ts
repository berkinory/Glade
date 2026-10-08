import { DesktopSshHost, type DesktopSshHostInput } from "@glade/contracts/ipc/sshHosts";
import { Option, Schema } from "effect";
import * as Crypto from "node:crypto";
import * as FS from "node:fs";
import * as Path from "node:path";

const SshHostsFile = Schema.Struct({
  version: Schema.Literal(1),
  hosts: Schema.Array(DesktopSshHost),
  // The machine each host reached on its first connection, by host id.
  machines: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
});
const decodeHostsFile = Schema.decodeUnknownOption(Schema.fromJsonString(SshHostsFile));

export interface SshHostsStore {
  list(): ReadonlyArray<DesktopSshHost>;
  get(hostId: string): DesktopSshHost | null;
  save(input: DesktopSshHostInput): DesktopSshHost;
  remove(hostId: string): void;
  machineOf(hostId: string): string | null;
  rememberMachine(hostId: string, machineId: string): void;
  forgetMachine(hostId: string): void;
}

export function createSshHostsStore(filePath: string): SshHostsStore {
  function readFile(): typeof SshHostsFile.Type {
    let contents: string;
    try {
      contents = FS.readFileSync(filePath, "utf8");
    } catch {
      return { version: 1, hosts: [] };
    }
    const decoded = decodeHostsFile(contents);
    if (Option.isNone(decoded)) {
      throw new Error(`The saved SSH hosts in ${filePath} are not valid.`);
    }
    return decoded.value;
  }

  const read = () => readFile().hosts;

  function write(
    hosts: ReadonlyArray<DesktopSshHost>,
    machines: Readonly<Record<string, string>> = readFile().machines ?? {},
  ): void {
    // Machines of removed hosts are dropped with them.
    const kept = Object.fromEntries(
      Object.entries(machines).filter(([hostId]) => hosts.some((host) => host.id === hostId)),
    );
    FS.mkdirSync(Path.dirname(filePath), { recursive: true });
    const temporary = `${filePath}.${process.pid}.tmp`;
    FS.writeFileSync(
      temporary,
      `${JSON.stringify({ version: 1, hosts, machines: kept }, null, 2)}\n`,
      { mode: 0o600 },
    );
    FS.renameSync(temporary, filePath);
  }

  return {
    list: read,
    get: (hostId) => read().find((host) => host.id === hostId) ?? null,
    save(input) {
      const { hosts, machines = {} } = readFile();
      const host: DesktopSshHost = {
        id: input.id ?? Crypto.randomUUID(),
        label: input.label,
        destination: input.destination,
        port: input.port,
        identityFile: input.identityFile,
      };
      const index = hosts.findIndex((existing) => existing.id === host.id);
      if (input.id !== undefined && index === -1)
        throw new Error("That SSH host no longer exists.");
      // A new address may lead to another machine on purpose, so it is learned again.
      const previous = hosts[index];
      const sameAddress = previous?.destination === host.destination && previous.port === host.port;
      write(
        index === -1
          ? [...hosts, host]
          : hosts.map((existing, i) => (i === index ? host : existing)),
        sameAddress
          ? machines
          : Object.fromEntries(Object.entries(machines).filter(([id]) => id !== host.id)),
      );
      return host;
    },
    remove(hostId) {
      write(read().filter((host) => host.id !== hostId));
    },
    machineOf: (hostId) => readFile().machines?.[hostId] ?? null,
    rememberMachine(hostId, machineId) {
      const { hosts, machines } = readFile();
      write(hosts, { ...machines, [hostId]: machineId });
    },
    forgetMachine(hostId) {
      const { hosts, machines = {} } = readFile();
      write(hosts, Object.fromEntries(Object.entries(machines).filter(([id]) => id !== hostId)));
    },
  };
}
