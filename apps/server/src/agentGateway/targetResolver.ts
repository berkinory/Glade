import { normalizeModelSlug } from "@glade/shared/provider/model";
import { type ModelSelection } from "@glade/contracts/provider/sessionPolicy";
import { type ProviderKind } from "@glade/contracts/core/baseSchemas";
import {
  type ProviderListModelsResult,
  type ProviderModelDescriptor,
} from "@glade/contracts/provider/providerDiscovery";
import { type ServerProviderAuthStatus } from "@glade/contracts/server/server";
import { Effect } from "effect";

import type { ProviderDiscoveryServiceShape } from "../provider/Services/ProviderDiscoveryService.ts";

export type AgentGatewayTargetErrorCode =
  | "provider_unavailable"
  | "model_unavailable"
  | "model_option_unavailable";

export class AgentGatewayTargetError extends Error {
  readonly _tag = "AgentGatewayTargetError";
  readonly code: AgentGatewayTargetErrorCode;
  readonly details?: unknown;

  constructor(code: AgentGatewayTargetErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "AgentGatewayTargetError";
    this.code = code;
    this.details = details;
  }
}

export interface AgentGatewayProviderCatalog {
  readonly provider: ProviderKind;
  readonly defaultModel: string | null;
  readonly models: ReadonlyArray<ProviderModelDescriptor>;
  readonly enabled: boolean;
  readonly available: boolean;
  readonly authStatus?: ServerProviderAuthStatus;
  readonly source?: string;
  readonly error?: string;
}

export interface AgentGatewayProviderAvailability {
  readonly enabled: boolean;

  readonly available?: boolean;
  readonly authStatus?: ServerProviderAuthStatus;
  readonly message?: string;
}

export const AGENT_GATEWAY_TARGET_OPTIONS_DESCRIPTION =
  "Provider-specific target options. Use targetConstruction[provider].optionsByModel[model] when present; otherwise use providerOptions. Preserve each option's exact key and valueType. allowedValues are authoritative unless allowsCustomValue is true.";

type AgentGatewayTargetOptionValue = string | number | boolean;

interface AgentGatewayTargetOptionRule {
  readonly key: string;
  readonly valueType: "string" | "number" | "boolean";
  readonly allowedValues: ReadonlyArray<AgentGatewayTargetOptionValue>;
  readonly allowedValuesSource: "provider-contract" | "model-discovery";
  readonly allowsCustomValue?: boolean;
}

export interface AgentGatewayTargetOptionGuidance {
  readonly primaryOptionKey: string;
  readonly alternativeOptionKeys: ReadonlyArray<string>;
  readonly optionSelectionRule: string;
  readonly providerOptions: ReadonlyArray<AgentGatewayTargetOptionRule>;
  readonly optionsByModel: Readonly<Record<string, ReadonlyArray<AgentGatewayTargetOptionRule>>>;
  readonly exampleTarget: {
    readonly provider: ProviderKind;
    readonly model: string;
    readonly options: Readonly<Record<string, AgentGatewayTargetOptionValue>>;
  } | null;
}

export function loadAgentGatewayProviderCatalog(input: {
  readonly provider: ProviderKind;
  readonly discovery: ProviderDiscoveryServiceShape;
  readonly availability?: AgentGatewayProviderAvailability;
  readonly cwd?: string;
}): Effect.Effect<AgentGatewayProviderCatalog> {
  const defaultModel = null;
  const availability = input.availability ?? { enabled: true };
  const unavailableReason =
    availability.enabled === false
      ? `Provider "${input.provider}" is disabled in Glade settings.`
      : availability.available === false
        ? (availability.message ?? `Provider "${input.provider}" is not available.`)
        : availability.authStatus === "unauthenticated"
          ? (availability.message ?? `Provider "${input.provider}" is not authenticated.`)
          : null;
  if (unavailableReason !== null) {
    return Effect.succeed({
      provider: input.provider,
      defaultModel,
      models: [],
      enabled: availability.enabled,
      available: false,
      ...(availability.authStatus ? { authStatus: availability.authStatus } : {}),
      error: unavailableReason,
    });
  }
  return input.discovery
    .listModels({ provider: input.provider, ...(input.cwd ? { cwd: input.cwd } : {}) })
    .pipe(
      Effect.map((result: ProviderListModelsResult) => ({
        provider: input.provider,
        defaultModel: result.models.find((model) => model.isDefault)?.slug ?? null,
        models: result.models,
        enabled: true,
        available: result.error === undefined,
        ...(result.error ? { error: result.error } : {}),
        ...(availability.authStatus ? { authStatus: availability.authStatus } : {}),
        ...(result.source ? { source: result.source } : {}),
      })),
      Effect.catch((error) =>
        Effect.succeed({
          provider: input.provider,
          defaultModel,
          models: [],
          enabled: true,
          available: false,
          ...(availability.authStatus ? { authStatus: availability.authStatus } : {}),
          error: error instanceof Error ? error.message : String(error),
        }),
      ),
    );
}

function modelTargetOptionRules(
  model: ProviderModelDescriptor,
): ReadonlyArray<AgentGatewayTargetOptionRule> {
  return (model.optionDescriptors ?? []).map((option) => ({
    key: option.id,
    valueType: option.type === "boolean" ? "boolean" : "string",
    allowedValues:
      option.type === "boolean" ? [true, false] : option.options.map((choice) => choice.id),
    allowedValuesSource: "model-discovery",
  }));
}

export function agentGatewayTargetOptionGuidance(
  catalog: AgentGatewayProviderCatalog,
): AgentGatewayTargetOptionGuidance {
  const optionsByModel = Object.fromEntries(
    catalog.models.map((model) => [model.slug, modelTargetOptionRules(model)]),
  );
  const defaultModel = catalog.models.find((model) => model.isDefault);
  const providerOptions = defaultModel ? modelTargetOptionRules(defaultModel) : [];
  const primaryOptionKey =
    providerOptions.find((option) => option.valueType === "string")?.key ?? "";
  return {
    primaryOptionKey,
    alternativeOptionKeys: providerOptions
      .map((option) => option.key)
      .filter((key) => key !== primaryOptionKey),
    optionSelectionRule:
      "Use the exact keys, types and values in optionsByModel. Omit options to inherit provider settings.",
    providerOptions,
    optionsByModel,
    exampleTarget:
      catalog.available && catalog.defaultModel !== null
        ? {
            provider: catalog.provider,
            model: catalog.defaultModel!,
            options: {},
          }
        : null,
  };
}

export function resolveAgentGatewayTarget(input: {
  readonly target: ModelSelection;
  readonly discovery: ProviderDiscoveryServiceShape;
  readonly availability?: AgentGatewayProviderAvailability;
  readonly cwd?: string;
}): Effect.Effect<ModelSelection, AgentGatewayTargetError> {
  return Effect.gen(function* () {
    const catalog = yield* loadAgentGatewayProviderCatalog({
      provider: input.target.provider,
      discovery: input.discovery,
      ...(input.availability ? { availability: input.availability } : {}),
      ...(input.cwd ? { cwd: input.cwd } : {}),
    });
    if (!catalog.available)
      return yield* Effect.fail(
        new AgentGatewayTargetError(
          "provider_unavailable",
          catalog.error ?? "Provider discovery is unavailable.",
        ),
      );
    const inherits = !normalizeModelSlug(input.target.model, input.target.provider);
    const descriptor = inherits
      ? catalog.models.find((model) => model.isDefault)
      : catalog.models.find(
          (model) =>
            model.slug === input.target.model || model.resolvedModel === input.target.model,
        );
    if (!descriptor)
      return yield* Effect.fail(
        new AgentGatewayTargetError(
          "model_unavailable",
          `Model "${input.target.model}" is not available for ${input.target.provider}.`,
          { availableModels: catalog.models.map((model) => model.slug) },
        ),
      );
    for (const [id, value] of Object.entries(input.target.options ?? {})) {
      if (value === undefined) continue;
      const option = descriptor?.optionDescriptors?.find((candidate) => candidate.id === id);
      const valid =
        option?.type === "boolean"
          ? typeof value === "boolean"
          : option?.type === "select"
            ? typeof value === "string" && option.options.some((choice) => choice.id === value)
            : false;
      if (!valid)
        return yield* Effect.fail(
          new AgentGatewayTargetError(
            "model_option_unavailable",
            `Option "${id}" is not available for ${input.target.provider}/${input.target.model}.`,
          ),
        );
    }
    return input.target.provider === "claudeAgent"
      ? {
          provider: input.target.provider,
          model: descriptor.slug,
          ...(input.target.options ? { options: input.target.options } : {}),
          ...(descriptor?.supportsAutoMode !== undefined
            ? { supportsAutoMode: descriptor.supportsAutoMode }
            : {}),
        }
      : { ...input.target, model: descriptor.slug };
  });
}
