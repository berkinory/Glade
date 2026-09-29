import { Schema } from "effect";

export const BrowserVaultSettings = Schema.Struct({
  agentUse: Schema.Boolean,
  offerSave: Schema.Boolean,
  autosave: Schema.Boolean,
});
export type BrowserVaultSettings = typeof BrowserVaultSettings.Type;

export const BrowserVaultLogin = Schema.Struct({
  id: Schema.String,
  origin: Schema.String,
  username: Schema.String,
  label: Schema.NullOr(Schema.String),
  source: Schema.Literals(["user", "agent", "unknown"]),
  updatedAt: Schema.String,
  status: Schema.Literals(["saved", "pending", "expired"]),
});
export type BrowserVaultLogin = typeof BrowserVaultLogin.Type;

export const BrowserVaultSavePrompt = Schema.Struct({
  id: Schema.String,
  origin: Schema.String,
  username: Schema.String,
  mode: Schema.Literals(["save", "update"]),
});
export type BrowserVaultSavePrompt = typeof BrowserVaultSavePrompt.Type;

export const BrowserVaultSnapshot = Schema.Struct({
  protection: Schema.Struct({
    configured: Schema.Boolean,
    locked: Schema.Boolean,
    osProtected: Schema.Boolean,
  }),
  logins: Schema.Array(BrowserVaultLogin),
  settings: BrowserVaultSettings,
  pending: Schema.Array(BrowserVaultSavePrompt),
  error: Schema.NullOr(Schema.String),
});
export type BrowserVaultSnapshot = typeof BrowserVaultSnapshot.Type;

export interface BrowserVaultMethods {
  snapshot(): Promise<BrowserVaultSnapshot>;
  configure(settings: BrowserVaultSettings): Promise<BrowserVaultSnapshot>;
  remove(id: string): Promise<BrowserVaultSnapshot>;
  respond(input: { id: string; save: boolean }): Promise<void>;
  setupMaster(password: string): Promise<void>;
  unlock(password: string): Promise<void>;
  lock(): Promise<void>;
  reveal(input: { id: string; password: string }): Promise<{ password: string; expiresAt: number }>;
  onChanged(listener: () => void): () => void;
}
