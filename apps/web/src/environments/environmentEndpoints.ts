import { LOCAL_ENVIRONMENT, type EnvironmentKey } from "./environmentKey";

// Where each SSH host's server answers through its tunnel. Kept apart from the environment registry
// so URL helpers can read it without importing the transport.
const wsUrlByEnvironment = new Map<EnvironmentKey, string>();

export function setEnvironmentWsUrl(key: EnvironmentKey, wsUrl: string | null): void {
  if (wsUrl === null) wsUrlByEnvironment.delete(key);
  else wsUrlByEnvironment.set(key, wsUrl);
}

export function environmentWsUrl(key: EnvironmentKey): string | null {
  return key === LOCAL_ENVIRONMENT ? null : (wsUrlByEnvironment.get(key) ?? null);
}

// A store applies server data inside this scope, so URLs it derives (attachment previews) point at
// the server the data came from rather than the chat that happens to be on screen.
let normalizingEnvironment: EnvironmentKey | null = null;

export function withNormalizingEnvironment<T>(key: EnvironmentKey, run: () => T): T {
  const previous = normalizingEnvironment;
  normalizingEnvironment = key;
  try {
    return run();
  } finally {
    normalizingEnvironment = previous;
  }
}

export function currentNormalizingEnvironment(): EnvironmentKey | null {
  return normalizingEnvironment;
}
