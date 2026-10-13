import { randomFillSync } from "node:crypto";

// MSP commands carry a client-minted UUIDv7 as their idempotency handle; the host rejects other ids.
export function mintMspCommandId(): string {
  const bytes = randomFillSync(new Uint8Array(16));
  let millis = Date.now();
  for (let index = 5; index >= 0; index -= 1) {
    bytes[index] = millis % 256;
    millis = Math.floor(millis / 256);
  }
  bytes[6] = (bytes[6]! & 0x0f) | 0x70;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Buffer.from(bytes).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
