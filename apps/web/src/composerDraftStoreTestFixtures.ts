import { ThreadId } from "@glade/contracts/core/baseSchemas";
import { type ModelSelection } from "@glade/contracts/provider/sessionPolicy";
import { type ProviderModelOptions } from "@glade/contracts/provider/model";
import { afterEach, beforeEach, vi } from "vitest";

import { partializeComposerDraftStoreState } from "./composerDraftPersistence.serialization";
import { useComposerDraftStore } from "./composerDraftStore";
import type {
  ComposerFileAttachment,
  ComposerImageAttachment,
  QueuedComposerTurn,
} from "./composerDraftDomain";
import type { TerminalContextDraft } from "./lib/terminalContext";

export function makeImage(input: {
  id: string;
  previewUrl: string;
  name?: string;
  mimeType?: string;
  sizeBytes?: number;
  lastModified?: number;
}): ComposerImageAttachment {
  const name = input.name ?? "image.png";
  const mimeType = input.mimeType ?? "image/png";
  const sizeBytes = input.sizeBytes ?? 4;
  const lastModified = input.lastModified ?? 1_700_000_000_000;
  const file = new File([new Uint8Array(sizeBytes).fill(1)], name, {
    type: mimeType,
    lastModified,
  });
  return {
    type: "image",
    id: input.id,
    name,
    mimeType,
    sizeBytes: file.size,
    previewUrl: input.previewUrl,
    file,
  };
}

export function makeFile(input: {
  id: string;
  name?: string;
  mimeType?: string;
  sizeBytes?: number;
  lastModified?: number;
}): ComposerFileAttachment {
  const name = input.name ?? "notes.txt";
  const mimeType = input.mimeType ?? "text/plain";
  const sizeBytes = input.sizeBytes ?? 4;
  const lastModified = input.lastModified ?? 1_700_000_000_000;
  const file = new File([new Uint8Array(sizeBytes).fill(2)], name, {
    type: mimeType,
    lastModified,
  });
  return {
    type: "file",
    id: input.id,
    name,
    mimeType,
    sizeBytes: file.size,
    file,
  };
}

export function makeTerminalContext(input: {
  id: string;
  text?: string;
  terminalId?: string;
  terminalLabel?: string;
  lineStart?: number;
  lineEnd?: number;
}): TerminalContextDraft {
  return {
    id: input.id,
    threadId: ThreadId.makeUnsafe("thread-dedupe"),
    terminalId: input.terminalId ?? "default",
    terminalLabel: input.terminalLabel ?? "Terminal 1",
    lineStart: input.lineStart ?? 4,
    lineEnd: input.lineEnd ?? 5,
    text: input.text ?? "git status\nOn branch main",
    createdAt: "2026-03-13T12:00:00.000Z",
  };
}

export function makeQueuedTurn(id: string): QueuedComposerTurn {
  return { ...makeQueuedChatTurn(id), terminalContexts: [], skills: [], mentions: [] };
}

export function makeQueuedChatTurn(
  id: string,
  image?: ComposerImageAttachment,
): QueuedComposerTurn {
  return {
    id,
    kind: "chat",
    createdAt: "2026-03-13T12:00:00.000Z",
    previewText: `queued chat ${id}`,
    prompt: "queued chat prompt",
    images: image ? [image] : [],
    files: [],
    assistantSelections: [],
    terminalContexts: [makeTerminalContext({ id: `ctx-${id}` })],
    fileComments: [],
    pastedTexts: [],
    pullRequestContexts: [],
    skills: [{ name: "check-code", path: "/skills/check-code" }],
    mentions: [{ name: "repo", path: "/mentions/repo" }],
    selectedProvider: "codex",
    selectedModel: "gpt-5",
    selectedPromptEffort: null,
    modelSelection: {
      provider: "codex",
      model: "gpt-5",
    },

    runtimeMode: "full-access",

    envMode: "local",
  };
}

export function resetComposerDraftStore() {
  useComposerDraftStore.setState({
    draftsByThreadId: {},
    draftThreadsByThreadId: {},
    projectDraftThreadIdByProjectId: {},
    stickyModelSelectionByProvider: {},
    stickyActiveProvider: null,
  });
}

export function modelSelection(
  provider: ModelSelection["provider"],
  model: string,
  options?: ModelSelection["options"],
): ModelSelection {
  return {
    provider,
    model,
    ...(options ? { options } : {}),
  } as ModelSelection;
}

export function providerModelOptions(options: ProviderModelOptions): ProviderModelOptions {
  return options;
}

type ComposerDraftStoreState = ReturnType<typeof useComposerDraftStore.getState>;

export function persistedAttachmentFor(image: ComposerImageAttachment) {
  return {
    id: image.id,
    name: image.name,
    mimeType: image.mimeType,
    sizeBytes: image.sizeBytes,
    dataUrl: "data:image/png;base64,aGk=",
  };
}

// Registers per-test hooks, so call it inside a describe block or at module scope.
export function stubRevokeObjectUrl(): ReturnType<typeof vi.fn<(url: string) => void>> {
  const revoke = vi.fn<(url: string) => void>();
  let original: typeof URL.revokeObjectURL;
  beforeEach(() => {
    revoke.mockReset();
    original = URL.revokeObjectURL;
    URL.revokeObjectURL = revoke;
  });
  afterEach(() => {
    URL.revokeObjectURL = original;
  });
  return revoke;
}

export function persistComposerDraftState(): {
  draftsByThreadId?: Record<string, Record<string, unknown>>;
} {
  return partializeComposerDraftStoreState(useComposerDraftStore.getState()) as {
    draftsByThreadId?: Record<string, Record<string, unknown>>;
  };
}

export function mergePersistedComposerDraftState(persisted: unknown): ComposerDraftStoreState {
  const persistApi = useComposerDraftStore.persist as unknown as {
    getOptions: () => {
      merge: (
        persistedState: unknown,
        currentState: ComposerDraftStoreState,
      ) => ComposerDraftStoreState;
    };
  };
  return persistApi.getOptions().merge(persisted, useComposerDraftStore.getInitialState());
}
