interface RunningChatQuitCandidate {
  readonly id: string;
  readonly title: string;
  readonly hasLiveTailWork?: boolean | undefined;
  readonly session?: { readonly status?: string | null } | null | undefined;
}

export interface RunningChatQuitSummary {
  readonly id: string;
  readonly title: string;
}

export interface RunningChatsQuitCopy {
  readonly title: string;
  readonly description: string;
  readonly resumeLabel: string;
  readonly stayLabel: string;
  readonly quitLabel: string;
}

const QUIT_RESUME_PREPARE_TIMEOUT_MS = 1500;

export interface RunningChatsQuitStoreSlice {
  readonly sidebarThreadSummaryById: Readonly<Record<string, RunningChatQuitCandidate>>;
  readonly threadSessionById?: Readonly<
    Record<string, { readonly status?: string | null } | null | undefined>
  >;
  readonly threadShellById?: Readonly<Record<string, { readonly title?: string } | undefined>>;
}

const UNTITLED_CHAT_TITLE = "Untitled thread";

function runningChatDisplayTitle(title: string | null | undefined): string {
  const trimmed = title?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : UNTITLED_CHAT_TITLE;
}

function isRunningChatForQuit(thread: {
  readonly hasLiveTailWork?: boolean | undefined;
  readonly session?: { readonly status?: string | null } | null | undefined;
}): boolean {
  if (thread.hasLiveTailWork === true) {
    return true;
  }
  const status = thread.session?.status;
  return status === "running" || status === "connecting";
}

function listRunningChatsForQuit(
  threads: ReadonlyArray<RunningChatQuitCandidate>,
): ReadonlyArray<RunningChatQuitSummary> {
  const seen = new Set<string>();
  const chats: RunningChatQuitSummary[] = [];
  for (const thread of threads) {
    if (seen.has(thread.id) || !isRunningChatForQuit(thread)) {
      continue;
    }
    seen.add(thread.id);
    chats.push({ id: thread.id, title: runningChatDisplayTitle(thread.title) });
  }
  return chats.toSorted(compareRunningChatSummaries);
}

export function listRunningChatsFromDesktopStore(
  state: RunningChatsQuitStoreSlice,
): ReadonlyArray<RunningChatQuitSummary> {
  const candidates: RunningChatQuitCandidate[] = Object.values(state.sidebarThreadSummaryById);
  const listedIds = new Set(candidates.map((thread) => thread.id));

  for (const [id, session] of Object.entries(state.threadSessionById ?? {})) {
    if (listedIds.has(id)) {
      continue;
    }
    candidates.push({
      id,
      title: state.threadShellById?.[id]?.title ?? "",
      session,
    });
  }

  return listRunningChatsForQuit(candidates);
}

export function runningChatsQuitCopy(
  chats: ReadonlyArray<RunningChatQuitSummary>,
  appName = "Glade",
): RunningChatsQuitCopy {
  return {
    title: chats.length === 1 ? "A chat is still running" : "Chats are still running",
    description: `Work in progress will stop when ${appName} is closed.`,
    resumeLabel: chats.length === 1 ? "Resume chat automatically" : "Resume chats automatically",
    stayLabel: "Cancel",
    quitLabel: "Quit",
  };
}

export function quitResumeContinuationPrompt(appName = "Glade"): string {
  return `${appName} closed while this chat was running. Resume the unfinished task under its latest scope and constraints. Check the last action's outcome and current state before repeating it; interrupted execution is not proof of success or failure.`;
}

export interface StopRunningChatsForQuitInput {
  readonly chats: ReadonlyArray<Pick<RunningChatQuitSummary, "id">>;
  readonly dispatchInterrupt: (threadId: string) => Promise<unknown> | unknown;
  // On failure or timeout fall back to plain interrupts so quit never hangs and never double-resumes.
  readonly resume?: {
    readonly prepare: (threadIds: ReadonlyArray<string>) => Promise<unknown>;
    readonly timeoutMs?: number;
  };
}

export interface StopRunningChatsForQuitResult {
  readonly resumeRecorded: boolean;
}

export async function stopRunningChatsForQuit(
  input: StopRunningChatsForQuitInput,
): Promise<StopRunningChatsForQuitResult> {
  if (input.chats.length === 0) {
    return { resumeRecorded: false };
  }
  const threadIds = input.chats.map((chat) => chat.id);

  if (input.resume) {
    const recorded = await withBoundedWait(
      () => input.resume!.prepare(threadIds),
      input.resume.timeoutMs ?? QUIT_RESUME_PREPARE_TIMEOUT_MS,
    );
    if (recorded) {
      return { resumeRecorded: true };
    }
  }

  // Fire-and-forget: the window must close as soon as the outcome is known, and an interrupt RPC
  // against an unresponsive server could otherwise hold quit for its full transport timeout.
  for (const threadId of threadIds) {
    void new Promise((resolve) => resolve(input.dispatchInterrupt(threadId))).catch(() => {});
  }
  return { resumeRecorded: false };
}

async function withBoundedWait(run: () => Promise<unknown>, timeoutMs: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), timeoutMs);
  });
  try {
    return await Promise.race([
      Promise.resolve()
        .then(run)
        .then(
          () => true,
          () => false,
        ),
      timeout,
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function compareRunningChatSummaries(
  left: RunningChatQuitSummary,
  right: RunningChatQuitSummary,
): number {
  const byTitle = left.title.localeCompare(right.title);
  if (byTitle !== 0) {
    return byTitle;
  }
  return left.id.localeCompare(right.id);
}
