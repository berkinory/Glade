interface PairingRoute {
  readonly url: string;
}

export interface PairingLink {
  readonly credential: string;
  readonly environmentId: string | null;
  // Addresses to try in order. A link from Glade lists every route it knows; a plain link has its
  // own origin only.
  readonly routes: ReadonlyArray<PairingRoute>;
}

function decodeRoutes(encoded: string | null): ReadonlyArray<PairingRoute> {
  if (!encoded) return [];
  try {
    const parsed: unknown = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((route) => {
      const url = (route as { url?: unknown } | null)?.url;
      return typeof url === "string" && /^https?:\/\//.test(url) ? [{ url }] : [];
    });
  } catch {
    return [];
  }
}

// Reads a link copied from another machine's "Pair a device" dialog.
export function parsePairingLink(raw: string): PairingLink {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new Error("That is not a pairing link. Copy it from Pair a device on the other machine.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("That is not a pairing link. Copy it from Pair a device on the other machine.");
  }
  const fragment = new URLSearchParams(url.hash.slice(1));
  const credential = fragment.get("token");
  if (!credential) {
    throw new Error("This link has no pairing code. Copy a fresh one from the other machine.");
  }
  const listed = decodeRoutes(fragment.get("routes"));
  const routes = listed.length > 0 ? listed : [{ url: url.origin }];
  return { credential, environmentId: fragment.get("env"), routes };
}
