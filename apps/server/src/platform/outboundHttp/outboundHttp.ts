import { randomUUID } from "node:crypto";
import type { LookupAddress } from "node:dns";
import * as Dns from "node:dns/promises";
import * as Http from "node:http";
import * as Https from "node:https";
import * as Net from "node:net";

import {
  assertExactLoopbackIpAddress,
  assertJsonWithinLimits,
  assertOutboundUrlAllowed,
  assertPublicIpAddress,
  isFakeIpDnsAddress,
  normalizeOutboundOrigin,
  stripOutboundSensitiveHeaders,
} from "./outboundHttpPolicy.ts";

export type OutboundHttpErrorCode =
  | "aborted"
  | "admission"
  | "compressed-response"
  | "dns"
  | "invalid-redirect"
  | "json"
  | "request"
  | "request-too-large"
  | "response-too-large"
  | "timeout";

export class OutboundHttpError extends Error {
  readonly code: OutboundHttpErrorCode;
  override readonly cause?: unknown;

  constructor(code: OutboundHttpErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = "OutboundHttpError";
    this.code = code;
    this.cause = cause;
  }
}

interface OutboundHttpPolicy {
  readonly service: string;
  readonly allowedOrigins: ReadonlyArray<string>;
  readonly timeoutMs: number;
  readonly maxRequestBytes: number;
  readonly maxResponseBytes: number;
  readonly maxRedirects: number;
  readonly maxConcurrent: number;
  readonly maxQueued: number;
  readonly requirePublicAddress?: boolean;

  readonly allowLoopbackHttp?: boolean;
  // Only for requests pinned to fixed, hard-coded origins: the sole listener on a fake-IP address
  // is the proxy that issued it, but a user-supplied host could aim the range anywhere.
  readonly allowFakeIpDnsAddresses?: boolean;
}

interface OutboundHttpRequest {
  readonly policy: OutboundHttpPolicy;
  readonly url: string | URL;
  readonly method?: "GET" | "HEAD" | "POST" | "PUT" | "PATCH" | "DELETE";
  readonly headers?: ConstructorParameters<typeof Headers>[0];
  readonly body?: string | Uint8Array;
  readonly signal?: AbortSignal;
}

export interface OutboundHttpResponse {
  readonly status: number;
  readonly headers: Headers;
  readonly body: Uint8Array;
  readonly url: string;
}

export interface OutboundMultipartPart {
  readonly name: string;
  readonly filename?: string;
  readonly contentType?: string;
  readonly body: string | Uint8Array;
}

export interface OutboundMultipartOptions {
  readonly maxBytes: number;
}

function quoteMultipartToken(value: string, label: string): string {
  if (!value || /[\r\n]/u.test(value)) {
    throw new OutboundHttpError("request", `Multipart ${label} is invalid.`);
  }
  return value.replace(/\\/gu, "\\\\").replace(/"/gu, '\\"');
}

function assertMultipartContentType(value: string): string {
  if (!value.trim() || /[\r\n]/u.test(value)) {
    throw new OutboundHttpError("request", "Multipart content type is invalid.");
  }
  return value;
}

export function encodeOutboundMultipart(
  parts: ReadonlyArray<OutboundMultipartPart>,
  options: OutboundMultipartOptions,
): { readonly body: Uint8Array; readonly contentType: string } {
  if (!Number.isSafeInteger(options.maxBytes) || options.maxBytes <= 0) {
    throw new OutboundHttpError("request", "Multipart byte limit must be a positive integer.");
  }
  const boundary = `Glade-${randomUUID()}`;
  const chunks: Uint8Array[] = [];
  const encoder = new TextEncoder();
  let size = 0;
  const push = (chunk: Uint8Array) => {
    if (chunk.byteLength > options.maxBytes - size) {
      throw new OutboundHttpError(
        "request-too-large",
        `Multipart request exceeded the ${options.maxBytes}-byte limit.`,
      );
    }
    chunks.push(chunk);
    size += chunk.byteLength;
  };

  for (const part of parts) {
    const disposition = [
      `form-data; name="${quoteMultipartToken(part.name, "field name")}"`,
      ...(part.filename ? [`filename="${quoteMultipartToken(part.filename, "filename")}"`] : []),
    ].join("; ");
    push(
      encoder.encode(
        `--${boundary}\r\nContent-Disposition: ${disposition}\r\n${
          part.contentType
            ? `Content-Type: ${assertMultipartContentType(part.contentType)}\r\n`
            : ""
        }\r\n`,
      ),
    );
    push(typeof part.body === "string" ? encoder.encode(part.body) : part.body);
    push(encoder.encode("\r\n"));
  }
  push(encoder.encode(`--${boundary}--\r\n`));

  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { body, contentType: `multipart/form-data; boundary=${boundary}` };
}

interface AdmissionWaiter {
  readonly resolve: () => void;
  readonly reject: (error: Error) => void;
  readonly signal?: AbortSignal;
  readonly onAbort?: () => void;
}

class AdmissionGate {
  private active = 0;
  private readonly waiters: AdmissionWaiter[] = [];

  constructor(
    private readonly limit: number,
    private readonly maxQueued: number,
  ) {}

  async acquire(signal?: AbortSignal): Promise<() => void> {
    if (signal?.aborted) {
      throw abortedError(signal.reason);
    }
    if (this.active < this.limit) {
      this.active += 1;
      return this.makeRelease();
    }
    if (this.waiters.length >= this.maxQueued) {
      throw new OutboundHttpError(
        "admission",
        "Outbound request admission queue is full for this service.",
      );
    }

    await new Promise<void>((resolve, reject) => {
      const waiter: AdmissionWaiter = {
        resolve,
        reject,
        ...(signal ? { signal } : {}),
        ...(signal
          ? {
              onAbort: () => {
                const index = this.waiters.indexOf(waiter);
                if (index >= 0) this.waiters.splice(index, 1);
                reject(abortedError(signal.reason));
              },
            }
          : {}),
      };
      if (signal && waiter.onAbort) {
        signal.addEventListener("abort", waiter.onAbort, { once: true });
      }
      this.waiters.push(waiter);
    });

    return this.makeRelease();
  }

  private makeRelease(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const next = this.waiters.shift();
      if (next) {
        if (next.signal && next.onAbort) {
          next.signal.removeEventListener("abort", next.onAbort);
        }
        next.resolve();
        return;
      }
      this.active -= 1;
    };
  }
}

const GLOBAL_MAX_CONCURRENT = 24;
const GLOBAL_MAX_QUEUED = 96;
const globalAdmission = new AdmissionGate(GLOBAL_MAX_CONCURRENT, GLOBAL_MAX_QUEUED);
// Streams can stay open for minutes, so they draw from their own budget and never hold the slots
// short requests share.
const globalStreamAdmission = new AdmissionGate(32, 128);
const serviceAdmissions = new Map<string, AdmissionGate>();

function serviceAdmission(policy: OutboundHttpPolicy): AdmissionGate {
  const existing = serviceAdmissions.get(policy.service);
  if (existing) return existing;
  const created = new AdmissionGate(policy.maxConcurrent, policy.maxQueued);
  serviceAdmissions.set(policy.service, created);
  return created;
}

function abortedError(reason?: unknown): OutboundHttpError {
  return new OutboundHttpError("aborted", "Outbound request was cancelled.", reason);
}

function bodyBytes(body: string | Uint8Array | undefined): Uint8Array | undefined {
  if (body === undefined) return undefined;
  return typeof body === "string" ? new TextEncoder().encode(body) : body;
}

function responseHeaders(headers: Http.IncomingHttpHeaders): Headers {
  const result = new Headers();
  for (const [name, value] of Object.entries(headers)) {
    if (Array.isArray(value)) {
      for (const item of value) result.append(name, item);
    } else if (value !== undefined) {
      result.set(name, value);
    }
  }
  return result;
}

function requestHeaders(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {};
  headers.forEach((value, name) => {
    result[name] = value;
  });
  return result;
}

interface PinnedAddress {
  readonly address: string;
  readonly family: 4 | 6;
}

type PinnedAddresses = readonly [PinnedAddress, ...PinnedAddress[]];

async function resolvePinnedAddresses(
  url: URL,
  requirePublicAddress: boolean,
  allowLoopbackHttp: boolean,
  allowFakeIpDnsAddresses: boolean,
  signal: AbortSignal,
): Promise<PinnedAddresses> {
  if (signal.aborted) throw abortedError(signal.reason);
  const hostname =
    url.hostname.startsWith("[") && url.hostname.endsWith("]")
      ? url.hostname.slice(1, -1)
      : url.hostname;
  const requireLoopbackAddress = allowLoopbackHttp && url.protocol === "http:";
  const assertAddressAllowed = (address: string) => {
    if (requireLoopbackAddress) assertExactLoopbackIpAddress(address);
    else if (requirePublicAddress) {
      if (allowFakeIpDnsAddresses && isFakeIpDnsAddress(address)) return;
      assertPublicIpAddress(address);
    }
  };
  const literalFamily = Net.isIP(hostname);
  if (literalFamily === 4 || literalFamily === 6) {
    assertAddressAllowed(hostname);
    return [{ address: hostname, family: literalFamily }];
  }

  let addresses: ReadonlyArray<PinnedAddress>;
  try {
    addresses = (await Promise.race([
      Dns.lookup(hostname, { all: true, verbatim: true }),
      new Promise<never>((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(abortedError(signal.reason)), {
          once: true,
        });
      }),
    ])) as ReadonlyArray<PinnedAddress>;
  } catch (cause) {
    if (cause instanceof OutboundHttpError) throw cause;
    throw new OutboundHttpError("dns", "Outbound destination DNS lookup failed.", cause);
  }
  for (const result of addresses) assertAddressAllowed(result.address);
  const [first, ...rest] = addresses;
  if (!first) {
    throw new OutboundHttpError("dns", "Outbound destination DNS lookup returned no addresses.");
  }
  return [first, ...rest];
}

// Every address was validated, so Happy Eyeballs may fall back from an unreachable IPv6 route.
export function invokePinnedDnsLookup(
  pinned: PinnedAddresses,
  options: { readonly all?: boolean | undefined } | undefined,

  callback: (
    err: NodeJS.ErrnoException | null,
    address: string | LookupAddress[],
    family?: number,
  ) => void,
): void {
  // Socket setup must attach its error listeners before lookup completion can fail TLS.
  queueMicrotask(() => {
    if (options?.all) {
      callback(null, [...pinned]);
      return;
    }
    callback(null, pinned[0].address, pinned[0].family);
  });
}

interface HopInput {
  readonly url: URL;
  readonly method: string;
  readonly headers: Headers;
  readonly body?: Uint8Array;
  readonly maxResponseBytes: number;
  readonly requirePublicAddress: boolean;
  readonly allowLoopbackHttp: boolean;
  readonly allowFakeIpDnsAddresses: boolean;
  readonly signal: AbortSignal;
}

interface OpenHop {
  readonly request: Http.ClientRequest;
  readonly response: Http.IncomingMessage;
  readonly headers: Headers;
}

function responseTooLarge(maxResponseBytes: number): OutboundHttpError {
  return new OutboundHttpError(
    "response-too-large",
    `Outbound response exceeded the ${maxResponseBytes}-byte limit.`,
  );
}

function chunkBytes(chunk: Buffer | Uint8Array | string): Uint8Array {
  return typeof chunk === "string" ? new TextEncoder().encode(chunk) : new Uint8Array(chunk);
}

// Resolves once response headers arrive; the caller owns reading or discarding the body.
async function openHop(input: HopInput): Promise<OpenHop> {
  const pinned = await resolvePinnedAddresses(
    input.url,
    input.requirePublicAddress,
    input.allowLoopbackHttp,
    input.allowFakeIpDnsAddresses,
    input.signal,
  );

  return await new Promise<OpenHop>((resolve, reject) => {
    const transport = input.url.protocol === "https:" ? Https : Http;
    // The HTTP option types omit Happy Eyeballs, but these options reach net.connect.
    const options: Https.RequestOptions & Pick<Net.TcpNetConnectOpts, "autoSelectFamily"> = {
      method: input.method,
      headers: requestHeaders(input.headers),
      signal: input.signal,
      autoSelectFamily: true,
      lookup: (_hostname, lookupOptions, callback) => {
        invokePinnedDnsLookup(pinned, lookupOptions, callback);
      },
    };
    const request = transport.request(input.url, options, (response) => {
      const headers = responseHeaders(response.headers);
      const encoding = headers.get("content-encoding")?.trim().toLowerCase();
      if (encoding && encoding !== "identity") {
        response.destroy();
        reject(
          new OutboundHttpError(
            "compressed-response",
            "Compressed outbound responses are rejected so byte limits remain exact.",
          ),
        );
        return;
      }
      const declaredLength = Number(headers.get("content-length"));
      if (Number.isFinite(declaredLength) && declaredLength > input.maxResponseBytes) {
        response.destroy();
        reject(responseTooLarge(input.maxResponseBytes));
        return;
      }
      resolve({ request, response, headers });
    });

    request.on("error", (cause) => {
      if (input.signal.aborted) {
        reject(abortedError(input.signal.reason));
      } else {
        reject(new OutboundHttpError("request", "Outbound request failed.", cause));
      }
    });
    if (input.body) request.write(input.body);
    request.end();
  });
}

function hopFailure(signal: AbortSignal, cause: unknown): OutboundHttpError {
  if (signal.aborted) return abortedError(signal.reason);
  return cause instanceof OutboundHttpError
    ? cause
    : new OutboundHttpError("request", "Outbound response failed.", cause);
}

async function requestHop(input: HopInput): Promise<OutboundHttpResponse> {
  const { request, response, headers } = await openHop(input);
  return await new Promise<OutboundHttpResponse>((resolve, reject) => {
    let settled = false;
    const settle = (result: OutboundHttpResponse | Error) => {
      if (settled) return;
      settled = true;
      if (result instanceof Error) reject(result);
      else resolve(result);
    };
    const chunks: Uint8Array[] = [];
    let size = 0;
    response.on("data", (chunk: Buffer | Uint8Array | string) => {
      const bytes = chunkBytes(chunk);
      size += bytes.byteLength;
      if (size > input.maxResponseBytes) {
        response.destroy();
        settle(responseTooLarge(input.maxResponseBytes));
        return;
      }
      chunks.push(bytes);
    });
    response.once("end", () => {
      const body = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        body.set(chunk, offset);
        offset += chunk.byteLength;
      }
      settle({ status: response.statusCode ?? 0, headers, body, url: input.url.href });
    });
    response.on("error", (cause) => settle(hopFailure(input.signal, cause)));
    request.on("error", (cause) => settle(hopFailure(input.signal, cause)));
  });
}

// Hands the body over as it arrives, with the same byte limit. `onSettled` runs exactly once,
// when the body ends, fails or is cancelled, so the caller can release its admission slots.
function streamHopBody(
  hop: OpenHop,
  input: HopInput,
  onSettled: () => void,
): ReadableStream<Uint8Array> {
  const { request, response } = hop;
  let settled = false;
  const settle = () => {
    if (settled) return;
    settled = true;
    onSettled();
  };
  return new ReadableStream<Uint8Array>({
    start(controller) {
      let size = 0;
      const fail = (cause: unknown) => {
        if (settled) return;
        response.destroy();
        controller.error(hopFailure(input.signal, cause));
        settle();
      };
      response.on("data", (chunk: Buffer | Uint8Array | string) => {
        if (settled) return;
        const bytes = chunkBytes(chunk);
        size += bytes.byteLength;
        if (size > input.maxResponseBytes) {
          fail(responseTooLarge(input.maxResponseBytes));
          return;
        }
        controller.enqueue(bytes);
        if ((controller.desiredSize ?? 1) <= 0) response.pause();
      });
      response.once("end", () => {
        if (settled) return;
        controller.close();
        settle();
      });
      response.on("error", fail);
      request.on("error", fail);
      response.once("close", () => {
        if (!response.complete) fail(new Error("Outbound response closed early."));
      });
    },
    pull() {
      response.resume();
    },
    cancel() {
      response.destroy();
      settle();
    },
  });
}

function isRedirectStatus(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

export interface OutboundHttpStreamResponse {
  readonly status: number;
  readonly headers: Headers;
  readonly url: string;
  // Read or cancel it: the request keeps its admission slots until the body settles.
  readonly body: ReadableStream<Uint8Array>;
}

interface PreparedRequest {
  readonly policy: OutboundHttpPolicy;
  readonly allowedOrigins: ReadonlyArray<string>;
  readonly originOptions: { readonly allowLoopbackHttp?: true };
  readonly url: URL;
  readonly method: string;
  readonly body: Uint8Array | undefined;
  readonly headers: Headers;
  readonly controller: AbortController;
  readonly release: () => void;
}

class OutboundHttpClient {
  private async prepare(
    input: OutboundHttpRequest,
    globalGate: AdmissionGate,
  ): Promise<PreparedRequest> {
    const policy = input.policy;
    const allowLoopbackHttp = policy.allowLoopbackHttp === true;
    const originOptions = allowLoopbackHttp ? { allowLoopbackHttp: true as const } : {};
    const allowedOrigins = policy.allowedOrigins.map((origin) =>
      normalizeOutboundOrigin(origin, originOptions),
    );
    const url = assertOutboundUrlAllowed({
      url: input.url,
      allowedOrigins,
      ...originOptions,
    });
    const body = bodyBytes(input.body);
    if ((body?.byteLength ?? 0) > policy.maxRequestBytes) {
      throw new OutboundHttpError(
        "request-too-large",
        `Outbound request exceeded the ${policy.maxRequestBytes}-byte limit.`,
      );
    }
    const headers = new Headers(input.headers);
    headers.set("accept-encoding", "identity");
    if (body) headers.set("content-length", String(body.byteLength));

    const controller = new AbortController();
    const abortFromCaller = () => controller.abort(input.signal?.reason);
    if (input.signal?.aborted) abortFromCaller();
    else input.signal?.addEventListener("abort", abortFromCaller, { once: true });
    const timeout = setTimeout(
      () =>
        controller.abort(
          new OutboundHttpError(
            "timeout",
            `Outbound request exceeded its ${policy.timeoutMs}ms deadline.`,
          ),
        ),
      policy.timeoutMs,
    );
    timeout.unref?.();

    let releaseGlobal: (() => void) | undefined;
    let releaseService: (() => void) | undefined;
    const release = () => {
      clearTimeout(timeout);
      input.signal?.removeEventListener("abort", abortFromCaller);
      releaseService?.();
      releaseGlobal?.();
    };
    // The service gate first: a request queued behind its own service's limit must not hold one of
    // the shared global slots while it waits.
    try {
      releaseService = await serviceAdmission(policy).acquire(controller.signal);
      releaseGlobal = await globalGate.acquire(controller.signal);
    } catch (cause) {
      release();
      throw failure(controller, cause);
    }
    return {
      policy,
      allowedOrigins,
      originOptions,
      url,
      method: input.method ?? "GET",
      body,
      headers,
      controller,
      release,
    };
  }

  private hopInput(
    prepared: PreparedRequest,
    target: Pick<HopInput, "url" | "method" | "headers"> & {
      readonly body: Uint8Array | undefined;
    },
  ): HopInput {
    const { policy } = prepared;
    return {
      url: target.url,
      method: target.method,
      headers: target.headers,
      ...(target.body ? { body: target.body } : {}),
      maxResponseBytes: policy.maxResponseBytes,
      requirePublicAddress: policy.requirePublicAddress ?? true,
      allowLoopbackHttp: policy.allowLoopbackHttp === true,
      allowFakeIpDnsAddresses: policy.allowFakeIpDnsAddresses === true,
      signal: prepared.controller.signal,
    };
  }

  async request(input: OutboundHttpRequest): Promise<OutboundHttpResponse> {
    const prepared = await this.prepare(input, globalAdmission);
    const { policy, allowedOrigins, originOptions, controller } = prepared;
    let url = prepared.url;
    let method = prepared.method;
    let body = prepared.body;
    let headers = prepared.headers;
    try {
      for (let redirects = 0; ; redirects += 1) {
        const response = await requestHop(this.hopInput(prepared, { url, method, headers, body }));
        if (!isRedirectStatus(response.status)) return response;
        if (redirects >= policy.maxRedirects) {
          throw new OutboundHttpError(
            "invalid-redirect",
            "Outbound response exceeded its redirect limit.",
          );
        }
        const location = response.headers.get("location");
        if (!location) {
          throw new OutboundHttpError(
            "invalid-redirect",
            "Outbound redirect did not include a Location header.",
          );
        }
        const nextUrl = assertOutboundUrlAllowed({
          url: new URL(location, url),
          allowedOrigins,
          ...originOptions,
        });
        if (nextUrl.origin !== url.origin) {
          if (originOptions.allowLoopbackHttp) {
            throw new OutboundHttpError(
              "invalid-redirect",
              "Loopback HTTP redirects must remain on the original origin.",
            );
          }
          headers = stripOutboundSensitiveHeaders(headers);
        }
        if (response.status === 303) {
          method = "GET";
          body = undefined;
          headers.delete("content-length");
          headers.delete("content-type");
        }
        url = nextUrl;
      }
    } catch (cause) {
      throw failure(controller, cause);
    } finally {
      prepared.release();
    }
  }

  // One hop, no redirects: a redirect status comes back as the response. The policy's deadline
  // covers the whole exchange, including the time spent reading the body.
  async stream(input: OutboundHttpRequest): Promise<OutboundHttpStreamResponse> {
    const prepared = await this.prepare(input, globalStreamAdmission);
    const hopInput = this.hopInput(prepared, prepared);
    let hop: OpenHop;
    try {
      hop = await openHop(hopInput);
    } catch (cause) {
      prepared.release();
      throw failure(prepared.controller, cause);
    }
    return {
      status: hop.response.statusCode ?? 0,
      headers: hop.headers,
      url: prepared.url.href,
      body: streamHopBody(hop, hopInput, prepared.release),
    };
  }
}

function failure(controller: AbortController, cause: unknown): unknown {
  if (!controller.signal.aborted) return cause;
  const reason: unknown = controller.signal.reason;
  if (reason instanceof OutboundHttpError && reason.code === "timeout") return reason;
  return abortedError(reason);
}

export const outboundHttp = new OutboundHttpClient();

function decodeOutboundText(response: OutboundHttpResponse): string {
  return new TextDecoder().decode(response.body);
}

export function decodeOutboundJson(
  response: OutboundHttpResponse,
  limits: { readonly maxDepth: number; readonly maxNodes: number },
): unknown {
  let value: unknown;
  try {
    value = JSON.parse(decodeOutboundText(response)) as unknown;
  } catch (cause) {
    throw new OutboundHttpError("json", "Outbound response was not valid JSON.", cause);
  }
  assertJsonWithinLimits(value, limits);
  return value;
}
