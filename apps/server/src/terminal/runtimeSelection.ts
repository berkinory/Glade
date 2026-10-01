export type PtyAdapterRuntime = "bun" | "node";

export function selectPtyAdapterRuntime(input: {
  readonly platform: NodeJS.Platform;
  readonly runtime: PtyAdapterRuntime;
}): PtyAdapterRuntime {
  return input.platform === "win32" ? "node" : input.runtime;
}
