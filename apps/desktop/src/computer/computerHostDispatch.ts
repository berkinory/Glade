import {
  COMPUTER_ENCODE_JPEG_METHOD,
  COMPUTER_USER_IDLE_METHOD,
  ComputerEncodeJpegParams,
  type ComputerEncodedImage,
  type ComputerUserIdle,
} from "@glade/contracts/computer/computerHost";
import { nativeImage, powerMonitor } from "electron";
import { Option, Schema } from "effect";

class ComputerHostFailure extends Error {
  constructor(
    readonly code: "invalid_input",
    message: string,
  ) {
    super(message);
  }
}

const decodeEncodeJpeg = Schema.decodeUnknownOption(ComputerEncodeJpegParams);

// The server has no image codec; Electron's does the PNG → JPEG step for Cua screenshots.
function encodeJpeg(method: string, params: unknown): ComputerEncodedImage {
  const input = decodeEncodeJpeg(params);
  if (Option.isNone(input)) {
    throw new ComputerHostFailure("invalid_input", `Invalid ${method} parameters.`);
  }
  const image = nativeImage.createFromBuffer(Buffer.from(input.value.data, "base64"));
  if (image.isEmpty())
    throw new ComputerHostFailure("invalid_input", "The image is not decodable.");
  const { width, height } = image.getSize();
  return { data: image.toJPEG(input.value.quality).toString("base64"), width, height };
}

// macOS (CGEventSource) and Windows (GetLastInputInfo) report system-wide input idle time in whole
// seconds. On Linux Chromium only knows it under X11 with the screensaver extension and reports 0
// otherwise, which would read as a user who never stops typing, so Linux reports unknown.
function userIdle(): ComputerUserIdle {
  return {
    idleSeconds:
      process.platform === "darwin" || process.platform === "win32"
        ? powerMonitor.getSystemIdleTime()
        : null,
  };
}

export async function dispatchComputerHost(
  method: string,
  params: unknown,
): Promise<ComputerEncodedImage | ComputerUserIdle> {
  if (method === COMPUTER_ENCODE_JPEG_METHOD) return encodeJpeg(method, params);
  if (method === COMPUTER_USER_IDLE_METHOD) return userIdle();
  throw new ComputerHostFailure("invalid_input", `Unknown computer host method ${method}.`);
}
