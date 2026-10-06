const FIRST_NAMES = [
  "Ada",
  "Alma",
  "Arlo",
  "Atlas",
  "Cleo",
  "Eden",
  "Elio",
  "Esme",
  "Finn",
  "Iris",
  "Juno",
  "Leo",
  "Mira",
  "Nova",
  "Remy",
  "Theo",
];
const LAST_NAMES = [
  "Ash",
  "Birch",
  "Brook",
  "Cove",
  "Dale",
  "Finch",
  "Fox",
  "Grove",
  "Lake",
  "Lark",
  "Moss",
  "Pine",
  "Reed",
  "Stone",
  "Vale",
  "Wren",
];

const NAMES = [
  "Ada",
  "Turing",
  "Curie",
  "Tesla",
  "Hopper",
  "Sagan",
  "Feynman",
  "Darwin",
  "Kepler",
  "Euler",
  "Noether",
  "Pascal",
  "Faraday",
  "Bohr",
  "Raman",
  "Newton",
  "Galileo",
  "Hypatia",
  "Socrates",
  "Plato",
  "Aristotle",
  "Descartes",
  "Spinoza",
  "Kant",
  "Hume",
  "Leibniz",
  "Hilbert",
  "Gauss",
  "Riemann",
  "Ramanujan",
  "Shannon",
  "Lovelace",
] as const;

function identityHash(identity: string): number {
  const nativeId = identity.startsWith("subagent:")
    ? identity.slice(identity.lastIndexOf(":") + 1)
    : identity;
  // Native identities give the same name before materialization and after restarting.
  let hash = 2166136261;
  for (let i = 0; i < nativeId.length; i++) {
    hash = Math.imul(hash ^ nativeId.charCodeAt(i), 16777619);
  }
  return hash >>> 0;
}

export function subagentName(identity: string): string {
  return NAMES[identityHash(identity) % NAMES.length] ?? NAMES[0];
}

export function resolveSubagentName(
  identity: string,
  nickname?: string | null,
  taskDescription?: string | null,
): string {
  const name = nickname?.trim();
  const hash = identityHash(identity);
  // Keep existing stored generated names readable without rewriting user data.
  const legacyName = `${FIRST_NAMES[hash % FIRST_NAMES.length]} ${LAST_NAMES[(hash >>> 16) % LAST_NAMES.length]}`;
  return name && name !== taskDescription?.trim() && name !== legacyName
    ? name
    : subagentName(identity);
}
