// Gateway tools read this Glade's own database. A thread that runs on an SSH host or a paired machine
// lives in that machine's Glade, so the message says where to look instead of implying it is gone.
export function threadNotFoundMessage(threadId: string): string {
  return `Thread "${threadId}" is not in this Glade. Threads that run on an SSH host or a paired machine are only visible from that machine.`;
}
