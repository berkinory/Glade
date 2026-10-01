import { createStreamBatching } from "./-streamBatching";
import type { StreamContext, StreamOperations } from "./-streamContracts";
import { subscribeStreamEvents } from "./-streamEvents";
import { createStreamPolicy } from "./-streamPolicy";
import { createStreamProjection } from "./-streamProjection";
import { createStreamState } from "./-streamState";
import { createStreamSubscriptions } from "./-streamSubscriptions";
export function createStreamRuntime(context: StreamContext) {
  const state = createStreamState();
  const operations: StreamOperations = {
    queueDomainEvent: (event) => batching.queueDomainEvent(event),
    reconcileThreadProjection: (id, options) => projection.reconcileThreadProjection(id, options),
    removeOrphanedTerminalsForCurrentState: () =>
      subscriptions.removeOrphanedTerminalsForCurrentState(),
  };
  const policy = createStreamPolicy(state, operations);
  const subscriptions = createStreamSubscriptions(context, state, operations, policy);
  const batching = createStreamBatching(context, state);
  const projection = createStreamProjection(context, state, policy, batching);
  return subscribeStreamEvents(
    context,
    state,
    operations,
    subscriptions,
    policy,
    projection,
    batching,
  );
}
