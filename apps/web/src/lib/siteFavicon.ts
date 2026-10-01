import { resolveWsHttpUrl } from "./wsHttpUrl";

export const siteFaviconStatusCache = new Map<string, "ok" | "fail">();

const inFlightFaviconProbes = new Map<string, Promise<"ok" | "fail">>();

export function probeSiteFavicon(faviconSrc: string): Promise<"ok" | "fail"> {
  const cached = siteFaviconStatusCache.get(faviconSrc);
  if (cached) return Promise.resolve(cached);

  const pending = inFlightFaviconProbes.get(faviconSrc);
  if (pending) return pending;

  const promise = new Promise<"ok" | "fail">((resolve) => {
    const image = new Image();
    image.addEventListener("load", () => resolve("ok"));
    image.addEventListener("error", () => resolve("fail"));
    image.src = faviconSrc;
  }).then((status) => {
    siteFaviconStatusCache.set(faviconSrc, status);
    inFlightFaviconProbes.delete(faviconSrc);
    return status;
  });

  inFlightFaviconProbes.set(faviconSrc, promise);
  return promise;
}

export function extractHostname(url: string): string | null {
  try {
    return new URL(url).hostname || null;
  } catch {
    return null;
  }
}

export function resolveSiteFaviconUrl(urlOrHost: string): string {
  const host = extractHostname(urlOrHost) ?? urlOrHost;
  const params = new URLSearchParams({ domain: host });

  return resolveWsHttpUrl(`/api/site-favicon?${params.toString()}`);
}
