import type { ThreadId } from "@glade/contracts/core/baseSchemas";
import { ServiceMap, type Effect } from "effect";
import type { ProviderAdapterShape } from "./ProviderAdapter";
import type { ProviderRuntimeBinding } from "./ProviderSessionDirectory";
import type {
  ProviderAdapterError,
  ProviderValidationError,
  ProviderUnsupportedError,
  ProviderSessionDirectoryPersistenceError,
} from "../core/Errors";
type RoutingError =
  | ProviderAdapterError
  | ProviderValidationError
  | ProviderUnsupportedError
  | ProviderSessionDirectoryPersistenceError;
interface RoutedSession {
  readonly adapter: ProviderAdapterShape<ProviderAdapterError>;
  readonly isActive: boolean;
  readonly lifecycleGeneration: string | undefined;
}
export class ProviderSessionRouting extends ServiceMap.Service<
  ProviderSessionRouting,
  {
    readonly resolveRoutableSession: (input: {
      readonly threadId: ThreadId;
      readonly operation: string;
      readonly allowRecovery: boolean;
    }) => Effect.Effect<RoutedSession, RoutingError>;
    readonly recoverSessionForThread: (input: {
      readonly binding: ProviderRuntimeBinding;
      readonly operation: string;
    }) => Effect.Effect<ProviderAdapterShape<ProviderAdapterError>, RoutingError>;
  }
>()("glade/provider/ProviderSessionRouting") {}
