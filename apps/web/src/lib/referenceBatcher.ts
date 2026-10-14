/**
 * Collects the lookups made in one task, such as every file chip a reply mounts, and sends them as
 * one request per group in chunks of `maxBatchSize`. `request` answers each reference in order.
 */
export function makeReferenceBatcher<T>(input: {
  maxBatchSize: number;
  request: (group: string, references: string[]) => Promise<ReadonlyArray<T>>;
}): (group: string, reference: string) => Promise<T> {
  type Pending = {
    reference: string;
    resolve: (value: T) => void;
    reject: (cause: unknown) => void;
  };
  const pendingByGroup = new Map<string, Pending[]>();

  async function requestAll(group: string, references: readonly string[]) {
    const answers = new Map<string, T>();
    for (let offset = 0; offset < references.length; offset += input.maxBatchSize) {
      const chunk = references.slice(offset, offset + input.maxBatchSize);
      const result = await input.request(group, chunk);
      if (result.length !== chunk.length) {
        throw new Error("Batched reference response length did not match the request.");
      }
      chunk.forEach((reference, index) => answers.set(reference, result[index]!));
    }
    return answers;
  }

  async function flush(group: string) {
    const pending = pendingByGroup.get(group) ?? [];
    pendingByGroup.delete(group);
    try {
      const answers = await requestAll(group, [
        ...new Set(pending.map((entry) => entry.reference)),
      ]);
      pending.forEach((entry) => entry.resolve(answers.get(entry.reference)!));
    } catch (cause) {
      pending.forEach((entry) => entry.reject(cause));
    }
  }

  return (group, reference) =>
    new Promise((resolve, reject) => {
      const pending = pendingByGroup.get(group);
      if (pending) {
        pending.push({ reference, resolve, reject });
        return;
      }
      pendingByGroup.set(group, [{ reference, resolve, reject }]);
      queueMicrotask(() => void flush(group));
    });
}
