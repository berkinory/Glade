import { WorkerPoolContext, useWorkerPool } from "@pierre/diffs/react";
import type { WorkerPoolManager } from "@pierre/diffs/worker";
import DiffsWorker from "@pierre/diffs/worker/worker.js?worker";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useTheme } from "../hooks/useTheme";
import { resolveDiffThemeName, type DiffThemeName } from "../lib/diffRendering";

// Each worker holds its own bundle, WASM and grammars, so the pool stays small and is torn down once no
// diff has been mounted for a while. The next diff to mount starts it again.
const DIFF_WORKER_POOL_SIZE = 2;
const DIFF_WORKER_IDLE_TERMINATE_MS = 3 * 60_000;

const AcquireDiffWorkers = createContext<(() => () => void) | null>(null);
const DiffWorkersSettled = createContext(true);

// A diff binds the pool once, when it mounts, and highlights on the main thread without one; a
// large file then freezes the window for seconds. Diffs mount once the pool is ready or has failed.
export function useActivateDiffWorkers(): boolean {
  const acquire = useContext(AcquireDiffWorkers);
  useEffect(() => acquire?.(), [acquire]);
  return useContext(DiffWorkersSettled);
}

function DiffWorkerThemeSync({ themeName }: { themeName: DiffThemeName }) {
  const workerPool = useWorkerPool();

  useEffect(() => {
    if (!workerPool) return;
    const current = workerPool.getDiffRenderOptions();
    if (current.theme === themeName) return;
    void workerPool.setRenderOptions({ ...current, theme: themeName }).catch((error: unknown) => {
      console.warn("Diff worker theme update failed", error);
    });
  }, [themeName, workerPool]);

  return null;
}

export function DiffWorkerPoolProvider({ children }: { children?: ReactNode }) {
  const { resolvedTheme } = useTheme();
  const diffThemeName = resolveDiffThemeName(resolvedTheme);
  const themeRef = useRef(diffThemeName);
  useEffect(() => {
    themeRef.current = diffThemeName;
  }, [diffThemeName]);
  const [active, setActive] = useState(false);
  const [workerPool, setWorkerPool] = useState<WorkerPoolManager>();
  const [failed, setFailed] = useState(false);
  const leaseCountRef = useRef(0);
  const idleTimerRef = useRef<number | null>(null);
  const [acquire] = useState(() => () => {
    leaseCountRef.current += 1;
    if (idleTimerRef.current !== null) {
      window.clearTimeout(idleTimerRef.current);
      idleTimerRef.current = null;
    }
    setActive(true);
    return () => {
      leaseCountRef.current -= 1;
      if (leaseCountRef.current > 0) return;
      idleTimerRef.current = window.setTimeout(() => {
        idleTimerRef.current = null;
        setActive(false);
      }, DIFF_WORKER_IDLE_TERMINATE_MS);
    };
  });
  useEffect(
    () => () => {
      if (idleTimerRef.current !== null) window.clearTimeout(idleTimerRef.current);
    },
    [],
  );

  useEffect(() => {
    if (!active) return;
    let disposed = false;
    let pool: WorkerPoolManager | undefined;
    void import("@pierre/diffs/worker")
      .then(({ WorkerPoolManager }) => {
        if (disposed) return;
        const created = new WorkerPoolManager(
          {
            workerFactory: () => new DiffsWorker(),
            poolSize: DIFF_WORKER_POOL_SIZE,
            totalASTLRUCacheSize: 240,
          },
          { theme: themeRef.current, tokenizeMaxLineLength: 1_000 },
        );
        pool = created;
        // A diff that mounts while the pool is still starting scrolls itself to its end.
        return created.initialize().then(() => {
          if (!disposed) setWorkerPool(created);
        });
      })
      .catch((error: unknown) => {
        console.warn("Diff worker pool initialization failed", error);
        if (!disposed) setFailed(true);
      });
    return () => {
      disposed = true;
      pool?.terminate();
      setWorkerPool(undefined);
      setFailed(false);
    };
  }, [active]);

  return (
    <AcquireDiffWorkers.Provider value={acquire}>
      <DiffWorkersSettled.Provider value={workerPool !== undefined || failed}>
        <WorkerPoolContext.Provider value={workerPool}>
          <DiffWorkerThemeSync themeName={diffThemeName} />
          {children}
        </WorkerPoolContext.Provider>
      </DiffWorkersSettled.Provider>
    </AcquireDiffWorkers.Provider>
  );
}
