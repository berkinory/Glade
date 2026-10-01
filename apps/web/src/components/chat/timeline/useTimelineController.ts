import type { MessagesTimelineProps } from "./timelineSupport";
import { useTimelineActionsController } from "./useTimelineActionsController";
import { useTimelineNavigationController } from "./useTimelineNavigationController";
import { useTimelineStateController } from "./useTimelineStateController";
export function useTimelineController(props: MessagesTimelineProps) {
  const state = useTimelineStateController(props);
  const navigation = useTimelineNavigationController({ state, props });
  const actions = useTimelineActionsController({ state, props });
  return { props, state, navigation, actions };
}
export type TimelineController = ReturnType<typeof useTimelineController>;
