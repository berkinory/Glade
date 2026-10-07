import { Schema } from "effect";

// Desktop → server: the embedded Cua driver's MCP launch spec for one driver generation, or why
// there is none. The desktop sends it after every change and again whenever a backend connects.
export const COMPUTER_CONNECTION_NOTIFICATION = "computer.connection";

export const COMPUTER_UNAVAILABLE_REASONS = [
  "unsupported_platform",
  "binary_missing",
  "binary_mismatch",
  "permissions_required",
  "starting",
  "failed",
] as const;
export type ComputerUnavailableReason = (typeof COMPUTER_UNAVAILABLE_REASONS)[number];

export const ComputerMcpLaunch = Schema.Struct({
  command: Schema.String,
  args: Schema.Array(Schema.String),
  environment: Schema.Array(Schema.Struct({ name: Schema.String, value: Schema.String })),
});
export type ComputerMcpLaunch = typeof ComputerMcpLaunch.Type;

export const ComputerConnection = Schema.Union([
  Schema.Struct({
    state: Schema.Literal("ready"),
    generation: Schema.String,
    driverVersion: Schema.String,
    mcp: ComputerMcpLaunch,
  }),
  Schema.Struct({
    state: Schema.Literal("unavailable"),
    reason: Schema.Literals(COMPUTER_UNAVAILABLE_REASONS),
    message: Schema.String,
  }),
]);
export type ComputerConnection = typeof ComputerConnection.Type;

// Server → desktop: re-encode a Cua PNG screenshot as JPEG at the same pixel size, so coordinates
// the model reads off the image stay in the driver's screenshot space.
export const COMPUTER_ENCODE_JPEG_METHOD = "computer.encodeJpeg";
export const ComputerEncodeJpegParams = Schema.Struct({
  data: Schema.String,
  quality: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100 })),
});
export const ComputerEncodedImage = Schema.Struct({
  data: Schema.String,
  width: Schema.Int,
  height: Schema.Int,
});
export type ComputerEncodedImage = typeof ComputerEncodedImage.Type;
