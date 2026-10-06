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

export function subagentName(identity: string): string {
  const nativeId = identity.startsWith("subagent:")
    ? identity.slice(identity.lastIndexOf(":") + 1)
    : identity;
  // Native identities give the same name before materialization and after restarting.
  let hash = 2166136261;
  for (let i = 0; i < nativeId.length; i++) {
    hash = Math.imul(hash ^ nativeId.charCodeAt(i), 16777619);
  }
  return `${FIRST_NAMES[(hash >>> 0) % FIRST_NAMES.length]} ${LAST_NAMES[(hash >>> 16) % LAST_NAMES.length]}`;
}
