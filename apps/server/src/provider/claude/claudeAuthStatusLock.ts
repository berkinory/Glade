let tail: Promise<unknown> = Promise.resolve();

export function acquireClaudeAuthStatusLock(): Promise<() => void> {
  const previousTail = tail;

  let resolveHeld: () => void;
  const held = new Promise<void>((resolve) => {
    resolveHeld = resolve;
  });

  tail = previousTail.then(() => held);

  return previousTail.then(() => {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      resolveHeld();
    };
  });
}
