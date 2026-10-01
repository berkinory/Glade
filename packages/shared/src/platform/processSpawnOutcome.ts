import type { ChildProcess } from "node:child_process";
import { errorMonitor, type EventEmitter } from "node:events";

const failedSpawns = new WeakSet<object>();

export function trackProcessSpawn<T extends ChildProcess>(child: T): T {
  const emitter: EventEmitter = child;
  const onSpawn = () => emitter.removeListener(errorMonitor, onError);
  const onError = () => {
    emitter.removeListener("spawn", onSpawn);
    if (child.pid === undefined) failedSpawns.add(child);
  };
  emitter.once(errorMonitor, onError);
  emitter.once("spawn", onSpawn);
  return child;
}

export function didProcessFailToSpawn(child: object): boolean {
  return failedSpawns.has(child);
}
