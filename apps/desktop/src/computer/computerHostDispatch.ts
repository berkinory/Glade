import {
  COMPUTER_ENCODE_JPEG_METHOD,
  ComputerEncodeJpegParams,
  type ComputerEncodedImage,
} from "@glade/contracts/computer/computerHost";
import { nativeImage } from "electron";
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
export async function dispatchComputerHost(
  method: string,
  params: unknown,
): Promise<ComputerEncodedImage> {
  if (method !== COMPUTER_ENCODE_JPEG_METHOD) {
    throw new ComputerHostFailure("invalid_input", `Unknown computer host method ${method}.`);
  }
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
