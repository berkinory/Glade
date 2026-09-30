// Wraps a dynamic `import()` in a memoized loader so a heavy dependency is resolved and evaluated
// at most once, and only when a code path actually needs it. Failures are memoized too, matching
// the ES module registry: a module that throws while evaluating is never re-evaluated, so retrying
// would only replay the same error.
export function lazyModule<M>(load: () => Promise<M>): () => Promise<M> {
  let modulePromise: Promise<M> | undefined;
  return () => (modulePromise ??= load());
}
