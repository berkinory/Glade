interface DesktopProjectRecoveryAttempt {
  readonly isCurrent: () => boolean;
  readonly complete: () => boolean;
  readonly release: () => void;
}

export interface DesktopProjectRecoveryAttemptGate {
  readonly begin: () => DesktopProjectRecoveryAttempt | null;
}

export function createDesktopProjectRecoveryAttemptGate(): DesktopProjectRecoveryAttemptGate {
  let currentOwner: symbol | "completed" | null = null;

  return {
    begin: () => {
      if (currentOwner !== null) return null;

      const owner = Symbol("desktop-project-recovery");
      currentOwner = owner;
      const isCurrent = () => currentOwner === owner;

      return {
        isCurrent,
        complete: () => {
          if (!isCurrent()) return false;
          currentOwner = "completed";
          return true;
        },
        release: () => {
          if (isCurrent()) currentOwner = null;
        },
      };
    },
  };
}
