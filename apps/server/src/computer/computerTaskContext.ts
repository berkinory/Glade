import { AsyncLocalStorage } from "node:async_hooks";
import type { CuaComputerTask } from "@glade/shared/cuaDriverProtocol";

const tasks = new AsyncLocalStorage<{ task: CuaComputerTask; active: boolean }>();

export function currentComputerTask(): CuaComputerTask | undefined {
  const scope = tasks.getStore();
  return scope?.active ? scope.task : undefined;
}

export async function withComputerTask<A>(
  task: CuaComputerTask,
  run: () => Promise<A>,
): Promise<A> {
  const scope = { task, active: true };
  try {
    return await tasks.run(scope, run);
  } finally {
    scope.active = false;
  }
}
