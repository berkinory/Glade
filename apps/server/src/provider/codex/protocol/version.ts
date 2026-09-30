import metadata from "./generated/metadata.json";

export const CODEX_PROTOCOL_VERSION = metadata.generatorVersion.slice("codex-cli ".length);
