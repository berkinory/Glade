// Tool rows re-read the same commands on every render, and one row reads its command through several
// parsers, so each pure parse is cached by the command text. Results are shared, never mutated.
const MAX_CACHED_COMMANDS = 4096;

export function cachedByCommand<T>(parse: (command: string) => T): (command: string) => T {
  const cache = new Map<string, T>();
  return (command) => {
    if (cache.has(command)) return cache.get(command)!;
    const value = parse(command);
    if (cache.size >= MAX_CACHED_COMMANDS) cache.delete(cache.keys().next().value!);
    cache.set(command, value);
    return value;
  };
}
