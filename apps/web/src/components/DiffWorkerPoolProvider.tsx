import { WorkerPoolContext, useWorkerPool } from "@pierre/diffs/react";
import type { WorkerPoolManager } from "@pierre/diffs/worker";
import DiffsWorker from "@pierre/diffs/worker/worker.js?worker";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useTheme } from "../hooks/useTheme";
import { resolveDiffThemeName, type DiffThemeName } from "../lib/diffRendering";

const ActivateDiffWorkers = createContext<(() => void) | null>(null);

export function useActivateDiffWorkers() {
  const activate = useContext(ActivateDiffWorkers);
  useEffect(() => activate?.(), [activate]);
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
  const [activate] = useState(() => () => setActive(true));

  useEffect(() => {
    if (!active) return;
    let disposed = false;
    let pool: WorkerPoolManager | undefined;
    void import("@pierre/diffs/worker")
      .then(({ WorkerPoolManager }) => {
        if (disposed) return;
        const cores = Math.max(1, navigator.hardwareConcurrency || 4);
        pool = new WorkerPoolManager(
          {
            workerFactory: () => new DiffsWorker(),
            poolSize: Math.max(2, Math.min(6, Math.floor(cores / 2))),
            totalASTLRUCacheSize: 240,
          },
          { theme: themeRef.current, tokenizeMaxLineLength: 1_000 },
        );
        setWorkerPool(pool);
      })
      .catch((error: unknown) => {
        console.warn("Diff worker pool initialization failed", error);
      });
    return () => {
      disposed = true;
      pool?.terminate();
    };
  }, [active]);

  return (
    <ActivateDiffWorkers.Provider value={activate}>
      <WorkerPoolContext.Provider value={workerPool}>
        <DiffWorkerThemeSync themeName={diffThemeName} />
        {children}
      </WorkerPoolContext.Provider>
    </ActivateDiffWorkers.Provider>
  );
}
