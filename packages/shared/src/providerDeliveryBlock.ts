// FILE: providerDeliveryBlock.ts
// Purpose: Single source for the "thread blocked by an earlier provider failure" message contract.
// Layer: Shared runtime utilities
// Exports: PROVIDER_DELIVERY_BLOCK_SUMMARY, formatProviderDeliveryBlockDetail

/**
 * Summary the provider command reactor records when it refuses to run a command
 * for a quarantined thread.
 */
export const PROVIDER_DELIVERY_BLOCK_SUMMARY = "Thread is blocked by an earlier provider failure";
const PROVIDER_DELIVERY_BLOCK_DETAIL_PREFIX = `${PROVIDER_DELIVERY_BLOCK_SUMMARY}:`;

/** Session error detail written for a quarantined thread, e.g. "<summary>: <blocker>". */
export function formatProviderDeliveryBlockDetail(blockerDetail: string): string {
  return `${PROVIDER_DELIVERY_BLOCK_DETAIL_PREFIX} ${blockerDetail}`;
}
