import { Schema } from "effect";

export const DESKTOP_HOST_RPC_PATH_ENV = "GLADE_DESKTOP_HOST_RPC_PATH";
export const DESKTOP_HOST_RPC_TOKEN_FD_ENV = "GLADE_DESKTOP_HOST_RPC_TOKEN_FD";
export const DESKTOP_HOST_RPC_MAX_FRAME_BYTES = 16 * 1024 * 1024;

export const DESKTOP_HOST_AUTH_METHOD = "auth";
export const DesktopHostAuthParams = Schema.Struct({ token: Schema.String });

// Application failures carry a stable string code in `error.data.code`; transport and protocol
// failures use the standard JSON-RPC codes.
export const DESKTOP_HOST_APPLICATION_ERROR = -32000;
export const DesktopHostErrorData = Schema.Struct({ code: Schema.String });
