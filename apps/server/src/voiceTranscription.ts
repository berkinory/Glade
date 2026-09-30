import { nonEmptyTrimmed } from "@glade/shared/text/text";
import { Buffer } from "node:buffer";

import type {
  ServerVoiceTranscriptionInput,
  ServerVoiceTranscriptionResult,
} from "@glade/contracts/server/server";
import { SERVER_VOICE_TRANSCRIPTION_MAX_AUDIO_BYTES } from "@glade/contracts/server/server";
import { requestChatGptVoiceTranscription } from "@glade/shared/http/chatGptVoiceTranscription";
import { decodeOutboundJson, type OutboundHttpResponse } from "@glade/shared/http/outboundHttp";

const MAX_DURATION_MS = 120_000;

export interface ChatGptVoiceAuthContext {
  readonly token: string;
  readonly transcriptionUrl?: string;
}

export async function transcribeVoiceWithChatGptSession(input: {
  readonly request: ServerVoiceTranscriptionInput;
  readonly resolveAuth: (refreshToken: boolean) => Promise<ChatGptVoiceAuthContext>;
  readonly signal?: AbortSignal;
}): Promise<ServerVoiceTranscriptionResult> {
  const audioBuffer = decodeVoiceAudio(input.request);
  let auth = await input.resolveAuth(false);
  let response = await requestTranscription({
    audioBuffer,
    mimeType: input.request.mimeType,
    token: auth.token,
    ...(input.signal ? { signal: input.signal } : {}),
    ...(auth.transcriptionUrl ? { transcriptionUrl: auth.transcriptionUrl } : {}),
  });

  if (response.status === 401 || response.status === 403) {
    auth = await input.resolveAuth(true);
    response = await requestTranscription({
      audioBuffer,
      mimeType: input.request.mimeType,
      token: auth.token,
      ...(input.signal ? { signal: input.signal } : {}),
      ...(auth.transcriptionUrl ? { transcriptionUrl: auth.transcriptionUrl } : {}),
    });
  }

  if (response.status < 200 || response.status >= 300) {
    throw new Error(readTranscriptionErrorMessage(response));
  }

  let payload: { text?: unknown; transcript?: unknown } | null = null;
  try {
    payload = decodeOutboundJson(response, { maxDepth: 16, maxNodes: 1_000 }) as {
      text?: unknown;
      transcript?: unknown;
    };
  } catch {
    payload = null;
  }
  const text = nonEmptyTrimmed(payload?.text) ?? nonEmptyTrimmed(payload?.transcript) ?? null;
  if (!text) {
    throw new Error("The transcription response did not include any text.");
  }

  return { text };
}

function decodeVoiceAudio(input: ServerVoiceTranscriptionInput): Buffer {
  if (input.mimeType !== "audio/wav") {
    throw new Error("Only WAV audio is supported for voice transcription.");
  }
  if (input.sampleRateHz !== 24_000) {
    throw new Error("Voice transcription requires 24 kHz mono WAV audio.");
  }
  if (input.durationMs <= 0) {
    throw new Error("Voice messages must include a positive duration.");
  }
  if (input.durationMs > MAX_DURATION_MS) {
    throw new Error("Voice messages are limited to 120 seconds.");
  }

  const normalizedBase64 = normalizeBase64(input.audioBase64);
  if (!normalizedBase64 || !isLikelyBase64(normalizedBase64)) {
    throw new Error("The recorded audio could not be decoded.");
  }

  const audioBuffer = Buffer.from(normalizedBase64, "base64");

  if (!audioBuffer.length || audioBuffer.length !== expectedBase64DecodedLength(normalizedBase64)) {
    throw new Error("The recorded audio could not be decoded.");
  }
  if (audioBuffer.length > SERVER_VOICE_TRANSCRIPTION_MAX_AUDIO_BYTES) {
    throw new Error("Voice messages are limited to 10 MB.");
  }
  if (!isLikelyWavBuffer(audioBuffer)) {
    throw new Error("The recorded audio is not a valid WAV file.");
  }

  return audioBuffer;
}

async function requestTranscription(input: {
  readonly audioBuffer: Buffer;
  readonly mimeType: string;
  readonly token: string;
  readonly transcriptionUrl?: string;
  readonly signal?: AbortSignal;
}): Promise<OutboundHttpResponse> {
  return requestChatGptVoiceTranscription({
    audio: input.audioBuffer,
    mimeType: input.mimeType,
    token: input.token,
    ...(input.transcriptionUrl ? { transcriptionUrl: input.transcriptionUrl } : {}),
    ...(input.signal ? { signal: input.signal } : {}),
  });
}

function readTranscriptionErrorMessage(response: OutboundHttpResponse): string {
  let errorMessage = `Transcription failed with status ${response.status}.`;
  try {
    const payload = decodeOutboundJson(response, { maxDepth: 16, maxNodes: 1_000 }) as {
      error?: { message?: unknown };
      message?: unknown;
    } | null;
    const providerMessage =
      nonEmptyTrimmed(payload?.error?.message) ?? nonEmptyTrimmed(payload?.message) ?? null;
    if (providerMessage) {
      errorMessage = providerMessage;
    }
  } catch {}

  if (response.status === 401 || response.status === 403) {
    return "Your ChatGPT login has expired. Sign in again.";
  }

  return errorMessage;
}

function normalizeBase64(value: string): string | null {
  const normalized = value.trim().replace(/\s+/g, "");
  return normalized.length > 0 ? normalized : null;
}

function isLikelyBase64(value: string): boolean {
  return value.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(value);
}

function expectedBase64DecodedLength(value: string): number {
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  return (value.length / 4) * 3 - padding;
}

function isLikelyWavBuffer(buffer: Buffer): boolean {
  return (
    buffer.length >= 12 &&
    buffer.toString("ascii", 0, 4) === "RIFF" &&
    buffer.toString("ascii", 8, 12) === "WAVE"
  );
}
