import type { NativeApi } from "@glade/contracts/ipc/ipc";
import type { ModelSelection, ProviderStartOptions } from "@glade/contracts/provider/sessionPolicy";
import { normalizeModelSlug } from "@glade/shared/provider/model";

export async function resolveProviderModelSelection(input: {
  api: NativeApi;
  selection: ModelSelection;
  cwd?: string;
  providerOptions?: ProviderStartOptions;
}): Promise<ModelSelection> {
  const { selection } = input;
  const model = normalizeModelSlug(selection.model, selection.provider);
  if (model) return { ...selection, model };
  const binaryPath = input.providerOptions?.[selection.provider]?.binaryPath;
  const catalog = await input.api.provider.listModels({
    provider: selection.provider,
    ...(input.cwd ? { cwd: input.cwd } : {}),
    ...(binaryPath ? { binaryPath } : {}),
  });
  const currentModel = catalog.models.find((entry) => entry.isDefault)?.slug;
  if (!currentModel)
    throw new Error(catalog.error ?? `${selection.provider} did not return a default model.`);
  return { ...selection, model: currentModel };
}
