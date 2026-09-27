import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const serverRuntimeSecret = randomBytes(32).toString("base64url");
export const SERVER_RUNTIME_CHALLENGE_HEADER = "x-glade-runtime-challenge";

export function computeServerRuntimeProof(secret: string, nonce: string): string {
  return createHmac("sha256", secret)
    .update("glade.server.runtime\0")
    .update(nonce)
    .digest("base64url");
}

export function runtimeProofsMatch(expected: string, actual: string): boolean {
  const left = Buffer.from(expected);
  const right = Buffer.from(actual);
  return left.length === right.length && timingSafeEqual(left, right);
}
