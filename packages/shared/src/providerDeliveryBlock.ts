export const PROVIDER_DELIVERY_BLOCK_SUMMARY = "Thread is blocked by an earlier provider failure";
const PROVIDER_DELIVERY_BLOCK_DETAIL_PREFIX = `${PROVIDER_DELIVERY_BLOCK_SUMMARY}:`;

export function formatProviderDeliveryBlockDetail(blockerDetail: string): string {
  return `${PROVIDER_DELIVERY_BLOCK_DETAIL_PREFIX} ${blockerDetail}`;
}
