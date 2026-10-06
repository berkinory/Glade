import { lookup } from "node:dns/promises";
import { BlockList, connect, createServer, isIP, type Socket } from "node:net";
import { networkInterfaces } from "node:os";
import { Effect } from "effect";
import { isPublicIpAddress } from "@glade/shared/http/outboundHttpPolicy";
import { VisualReplyError } from "./visualReplySource";

const translatedAddresses = new BlockList();
for (const [network, prefix] of [
  ["::", 96],
  ["64:ff9b:1::", 48],
  ["2001::", 32],
  ["2002::", 16],
] as const)
  translatedAddresses.addSubnet(network, prefix, "ipv6");

async function resolvePublicAddresses(host: string) {
  const addresses = isIP(host)
    ? [{ address: host, family: isIP(host) }]
    : await lookup(host, { all: true, verbatim: true });
  const own = new BlockList();
  for (const entries of Object.values(networkInterfaces()))
    for (const entry of entries ?? [])
      own.addAddress(entry.address, entry.family === "IPv6" ? "ipv6" : "ipv4");
  if (
    addresses.length === 0 ||
    addresses.some(
      ({ address, family }) =>
        !isPublicIpAddress(address) ||
        own.check(address, family === 6 ? "ipv6" : "ipv4") ||
        (family === 6 && translatedAddresses.check(address, "ipv6")),
    )
  )
    throw new Error("Preview destination is not public.");
  return addresses;
}

function readTarget(data: Buffer) {
  if (data.length < 5) return null;
  if (data[0] !== 5 || data[1] !== 1 || data[2] !== 0)
    throw new Error("Unsupported SOCKS command.");
  const type = data[3];
  const end = type === 1 ? 10 : type === 3 ? 7 + data[4]! : type === 4 ? 22 : 0;
  if (!end) throw new Error("Invalid SOCKS address.");
  if (data.length < end) return null;
  const host =
    type === 1
      ? [...data.subarray(4, 8)].join(".")
      : type === 3
        ? data.subarray(5, end - 2).toString("ascii")
        : Array.from({ length: 8 }, (_, index) =>
            data.readUInt16BE(4 + index * 2).toString(16),
          ).join(":");
  const port = data.readUInt16BE(end - 2);
  if (!port || !host || host.includes("\0")) throw new Error("Invalid SOCKS target.");
  return { host, port, early: data.subarray(end) };
}

const response = (code: number) => Buffer.from([5, code, 0, 1, 0, 0, 0, 0, 0, 0]);

// All browser TCP traffic goes through this tunnel, including TLS, WebSockets and prefetch.
// DNS is resolved once and the checked addresses are pinned into the connection lookup.
export const publicPreviewProxy = Effect.acquireRelease(
  Effect.tryPromise({
    try: () =>
      new Promise<{ readonly port: number; readonly close: () => Promise<void> }>(
        (resolve, reject) => {
          const sockets = new Set<Socket>();
          const track = (socket: Socket) => {
            sockets.add(socket);
            socket.on("close", () => sockets.delete(socket));
            socket.on("error", () => socket.destroy());
            socket.setTimeout(20_000, () => socket.destroy());
            return socket;
          };
          const server = createServer((client) => {
            track(client);
            let buffered = Buffer.alloc(0);
            let greeted = false;
            const refuse = () => client.end(response(2), () => client.destroy());
            const onData = (chunk: Buffer) => {
              buffered = Buffer.concat([buffered, chunk]);
              if (buffered.length > 64 * 1024) return void client.destroy();
              if (!greeted) {
                if (buffered.length < 2 || buffered.length < 2 + buffered[1]!) return;
                const length = 2 + buffered[1]!;
                if (buffered[0] !== 5 || !buffered.subarray(2, length).includes(0))
                  return void client.end(Buffer.from([5, 255]), () => client.destroy());
                buffered = buffered.subarray(length);
                greeted = true;
                client.write(Buffer.from([5, 0]));
              }
              let target;
              try {
                target = readTarget(buffered);
              } catch {
                return void refuse();
              }
              if (!target) return;
              client.off("data", onData);
              const early = [target.early];
              let earlySize = target.early.length;
              const hold = (bytes: Buffer) => {
                earlySize += bytes.length;
                if (earlySize > 64 * 1024) client.destroy();
                else early.push(bytes);
              };
              client.on("data", hold);
              void resolvePublicAddresses(target.host)
                .then((addresses) => {
                  if (client.destroyed) return;
                  client.off("data", hold);
                  client.pause();
                  const upstream = track(
                    connect({
                      host: target.host,
                      port: target.port,
                      autoSelectFamily: true,
                      lookup: (_host, options, callback) =>
                        options.all
                          ? callback(null, addresses)
                          : callback(null, addresses[0]!.address, addresses[0]!.family),
                    }),
                  );
                  upstream.once("connect", () => {
                    client.write(response(0));
                    for (const bytes of early) upstream.write(bytes);
                    upstream.pipe(client);
                    client.pipe(upstream);
                  });
                  upstream.on("close", () => client.destroy());
                  client.on("close", () => upstream.destroy());
                })
                .catch(() => {
                  if (!client.destroyed) refuse();
                });
            };
            client.on("data", onData);
          });
          let listening = false;
          server.on("error", (error) => {
            if (!listening) reject(error);
          });
          server.listen(0, "127.0.0.1", () => {
            const address = server.address();
            if (!address || typeof address === "string")
              return reject(new Error("Proxy port unavailable."));
            listening = true;
            resolve({
              port: address.port,
              close: () =>
                new Promise<void>((done) => {
                  for (const socket of sockets) socket.destroy();
                  server.close(() => done());
                }),
            });
          });
        },
      ),
    catch: (cause) => new VisualReplyError({ message: `Preview proxy failed: ${String(cause)}` }),
  }),
  (proxy) => Effect.promise(proxy.close),
).pipe(Effect.map((proxy) => proxy.port));
